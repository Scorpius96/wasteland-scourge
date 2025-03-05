const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions] 
});

const TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const WSC_COIN_TYPE = '0x0b8efbace2485175dba014eaca68556c113c111300e44155200d8ba42f93ab9d::wsc::WSC';
const WSC_PRICE = 0.10;
const ADMIN_ADDRESS = '0xdbfb5034a49be4deba3f01f1e8455148d4657f0bc4344ac5ad39c0c121f53671';

const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));

let gameState = fs.existsSync('/data/state.json') ? JSON.parse(fs.readFileSync('/data/state.json')) : { players: {} };

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const suiBalance = await suiClient.getBalance({ owner: ADMIN_ADDRESS });
  console.log(`Admin SUI Balance: ${suiBalance.totalBalance} MIST`);
  setInterval(() => {
    for (const player of Object.values(gameState.players)) {
      player.hp = Math.min(100, player.hp + 10);
      player.energy = Math.min(5, player.energy + 1);
    }
    saveState();
    console.log('Regen ticked at', new Date().toISOString());
  }, 60 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  let player = gameState.players[message.author.id] || {};

  if (command === 'register') {
    const suiAddress = args[0];
    if (!suiAddress || !suiAddress.startsWith('0x') || suiAddress.length !== 66) {
      message.reply('Usage: !register <Sui Address> <Name>');
      return;
    }
    const wscCost = Math.round(2 / WSC_PRICE) * 1000000;
    try {
      const wscCoins = await suiClient.getCoins({ owner: ADMIN_ADDRESS, coinType: WSC_COIN_TYPE });
      if (!wscCoins.data.length) throw new Error('No WSC in admin wallet');
      const sufficientWscCoin = wscCoins.data.find(coin => parseInt(coin.balance) >= wscCost);
      if (!sufficientWscCoin) throw new Error(`No WSC coin with balance >= ${wscCost}`);
      const wscCoinId = sufficientWscCoin.coinObjectId;

      const suiCoins = await suiClient.getCoins({ owner: ADMIN_ADDRESS });
      if (!suiCoins.data.length) throw new Error('No SUI for gas');
      const gasCoinId = suiCoins.data[0].coinObjectId;

      const wscTx = new Transaction();
      const [wscCoin] = wscTx.splitCoins(wscTx.object(wscCoinId), [wscCost]);
      wscTx.transferObjects([wscCoin], suiAddress);
      wscTx.setGasBudget(20000000);
      wscTx.setGasPayment([{ objectId: gasCoinId, version: suiCoins.data[0].version, digest: suiCoins.data[0].digest }]);
      const wscResult = await suiClient.signAndExecuteTransaction({
        transaction: wscTx,
        signer: keypair,
        options: { showEffects: true }
      });

      gameState.players[message.author.id] = { 
        suiAddress, name: args[1] || `Raider_${message.author.id.slice(-4)}`, 
        hp: 100, attack: 10, armor: 0, energy: 5, 
        equipped: { weapon: false, armor: false }, 
        active: { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 }, 
        bunker: { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 }, 
        lastRaid: 0, inventory: { scavJuice: 1 } 
      };
      player = gameState.players[message.author.id];
      message.reply(`Registered as ${player.name} for 20 WSC! HP: 100, Energy: 5, 1 Scav Juice added.\nTx: ${wscResult.digest}`);
      saveState();
    } catch (error) {
      message.reply(`Registration failed: ${error.message}\nAdmin wallet needs WSC (20M raw) and SUI gas (20M raw).`);
      console.error('Register error:', error);
    }
  }

  if (command === 'raid') {
    if (!player.suiAddress) {
      message.reply('Register with !register first!');
      return;
    }
    const now = Date.now();
    if (now - player.lastRaid < 60 * 60 * 1000) {
      const wait = Math.ceil((60 * 60 * 1000 - (now - player.lastRaid)) / 60000);
      message.reply(`You’re recovering from death! Wait ${wait} minutes.`);
      return;
    }
    if (player.hp <= 0) {
      message.reply(`You’re dead! Regen in progress (10 HP/hour). HP: ${player.hp}`);
      return;
    }
    if (player.energy < 1) {
      message.reply(`Out of energy! Regen 1 every 3 hours. Energy: ${player.energy}/5`);
      return;
    }

    player.energy -= 1;
    player.armor = player.armor || 0;
    player.equipped = player.equipped || { weapon: false, armor: false };
    const attack = player.equipped.weapon ? player.attack + 5 : player.attack;
    const settings = [
      { name: 'City Ruins', desc: 'Crumbling towers loom...', tier1Chance: 1, tier2Chance: 0 },
      { name: 'Glowing Dunes', desc: 'Shimmering haze drifts...', tier1Chance: 1, tier2Chance: 0 },
      { name: 'Scav Shanties', desc: 'Huts creak in the wind...', tier1Chance: 0.9, tier2Chance: 0.1 },
      { name: 'Death’s Hollow', desc: 'A pit echoes with growls...', tier1Chance: 0.5, tier2Chance: 0.5 }
    ];
    const roll = Math.random();
    const setting = roll < 0.95 ? settings[Math.floor(Math.random() * 3)] : settings[3];
    const isDeathsHollow = setting.name === 'Death’s Hollow';

    const enemies = [
      { name: 'Rust Creeper', hpMin: 20, hpMax: 25, attackMin: 3, attackMax: 5, scrMin: 0.03, scrMax: 0.05 },
      { name: 'Glow Hound', hpMin: 25, hpMax: 30, attackMin: 4, attackMax: 6, scrMin: 0.04, scrMax: 0.06 },
      { name: 'Dust Wretch', hpMin: 20, hpMax: 30, attackMin: 3, attackMax: 5, scrMin: 0.05, scrMax: 0.07 },
      { name: 'Sludge Leech', hpMin: 15, hpMax: 20, attackMin: 5, attackMax: 7, scrMin: 0.02, scrMax: 0.04 },
      { name: 'Iron Maw', hpMin: 40, hpMax: 50, attackMin: 8, attackMax: 10, scrMin: 0.15, scrMax: 0.2 },
      { name: 'Rad Reaver', hpMin: 35, hpMax: 45, attackMin: 7, attackMax: 9, scrMin: 0.1, scrMax: 0.15 },
      { name: 'Radiated Scorpion King', hpMin: 50, hpMax: 60, attackMin: 10, attackMax: 12, scrMin: 1, scrMax: 1 }
    ];
    let enemy = null;
    let enemyHp = 0;
    let enemyAttack = 0;
    let loot = { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 };
    let stage = 1;
    let depth = 0;

    const getFightButtons = (enemyAlive) => new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('attack').setLabel('Attack').setStyle(ButtonStyle.Primary).setDisabled(!enemyAlive),
        new ButtonBuilder().setCustomId('continue').setLabel('Continue').setStyle(ButtonStyle.Primary).setDisabled(enemyAlive),
        new ButtonBuilder().setCustomId('run').setLabel('Run').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('heal').setLabel('Heal').setStyle(ButtonStyle.Success)
      );

    const getChoiceButtons = () => new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('back').setLabel('Back to Bunker').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('deeper').setLabel('Continue On').setStyle(ButtonStyle.Danger).setDisabled(player.energy < 1)
      );

    const setEnemy = (isDeep = false) => {
      const tierRoll = Math.random();
      const enemyOptions = isDeathsHollow && stage === 3 && !isDeep
        ? (Math.random() < 0.01 ? [enemies[6]] : enemies.slice(4, 6))
        : tierRoll < setting.tier1Chance ? enemies.slice(0, 4) : enemies.slice(4, 6);
      enemy = enemyOptions[Math.floor(Math.random() * enemyOptions.length)];
      enemyHp = Math.floor(Math.random() * (enemy.hpMax - enemy.hpMin + 1)) + enemy.hpMin * (1 + depth * 0.1);
      enemyAttack = Math.floor(Math.random() * (enemy.attackMax - enemy.attackMin + 1)) + enemy.attackMin * (1 + depth * 0.1);
    };

    setEnemy();
    let raidMessage = await message.reply({
      content: `${player.name} enters ${setting.name}\n${setting.desc}\nFight: ${enemy.name} (HP: ${enemyHp}) lunges!\nHP: ${player.hp}, Energy: ${player.energy}/5\nPick an action:`,
      components: [getFightButtons(true)]
    });

    const filter = i => i.user.id === message.author.id && ['attack', 'continue', 'run', 'heal', 'back', 'deeper'].includes(i.customId);
    const collector = raidMessage.createMessageComponentCollector({ filter, time: 120000 });

    collector.on('collect', async (interaction) => {
      await interaction.deferUpdate();
      let update = '';

      if (interaction.customId === 'attack' && enemyHp > 0) {
        enemyHp -= attack;
        update += `${player.name} hits ${enemy.name} for ${attack}. Enemy HP: ${enemyHp}\n`;
        if (enemyHp > 0) {
          const rawDamage = enemyAttack;
          const reduction = player.armor * 0.1;
          const damage = Math.floor(rawDamage * (1 - reduction));
          player.hp -= damage;
          update += `${enemy.name} hits for ${damage} (reduced by ${player.armor * 10}%). HP: ${player.hp}\n`;
        } else {
          const scrLoot = (Math.random() * (enemy.scrMax - enemy.scrMin) + enemy.scrMin) * (1 + depth * 0.2);
          loot.scr += scrLoot;
          update += `${enemy.name} falls! +${scrLoot.toFixed(2)} SCR\n`;
        }
      } else if (interaction.customId === 'continue' && enemyHp <= 0) {
        stage += 1;
        if (stage === 2) {
          const scavengeScr = (Math.random() < 0.7 ? 0.1 : 0.05) * (1 + depth * 0.2);
          loot.scr += scavengeScr;
          if (Math.random() < 0.005) loot.scrapMetal += 1;
          else if (Math.random() < 0.003) loot.rustShard += 1;
          else if (Math.random() < 0.002) loot.glowDust += 1;
          update += `Scavenge: +${scavengeScr.toFixed(2)} SCR${loot.scrapMetal > 0 ? ', +1 Scrap Metal' : loot.rustShard > 0 ? ', +1 Rust Shard' : loot.glowDust > 0 ? ', +1 Glow Dust' : ''}\n`;
        } else if (stage === 3 && isDeathsHollow) {
          setEnemy();
          update += `Fight: ${enemy.name} (HP: ${enemyHp}) lunges!\n`;
        } else if (stage === 3 || (stage === 4 && isDeathsHollow)) {
          const encounters = [
            { name: 'Radiation Leak', hpLoss: 5, scr: 0.05 },
            { name: 'Razor Snare', hpLoss: 5, scr: 0.05 },
            { name: 'Wasteland Stumble', hpLoss: 5, scr: 0.05 },
            { name: 'Radiated Rat Swarm', hpLoss: 10, scr: 0.5 },
            { name: 'Loot Cache', hpLoss: 0, scr: 0.5 }
          ];
          const encounter = encounters[Math.floor(Math.random() * encounters.length)];
          const reducedLoss = Math.floor(encounter.hpLoss * (1 - player.armor * 0.1));
          player.hp -= reducedLoss;
          loot.scr += encounter.scr * (1 + depth * 0.2);
          if (encounter.name === 'Loot Cache') {
            if (Math.random() < 0.02) loot.scrapMetal += 1;
            else if (Math.random() < 0.02) loot.rustShard += 1;
            else if (Math.random() < 0.02) loot.glowDust += 1;
          } else {
            if (Math.random() < 0.005) loot.scrapMetal += 1;
            else if (Math.random() < 0.003) loot.rustShard += 1;
            else if (Math.random() < 0.002) loot.glowDust += 1;
          }
          update += `${encounter.name}: ${encounter.hpLoss > 0 ? `-${reducedLoss} HP (reduced by ${player.armor * 10}%)` : ''}, +${(encounter.scr * (1 + depth * 0.2)).toFixed(2)} SCR${loot.scrapMetal > 0 ? ', +1 Scrap Metal' : loot.rustShard > 0 ? ', +1 Rust Shard' : loot.glowDust > 0 ? ', +1 Glow Dust' : ''}\n`;
          if (player.hp > 0) {
            update += `Survived ${setting.name}! Loot so far: ${loot.scr.toFixed(2)} SCR${loot.scrapMetal > 0 ? `, ${loot.scrapMetal} Scrap Metal` : ''}${loot.rustShard > 0 ? `, ${loot.rustShard} Rust Shard${loot.rustShard > 1 ? 's' : ''}` : ''}${loot.glowDust > 0 ? `, ${loot.glowDust} Glow Dust` : ''}\n`;
          }
        }
      } else if (interaction.customId === 'back') {
        player.bunker.scr += loot.scr;
        player.bunker.scrapMetal += loot.scrapMetal;
        player.bunker.rustShard += loot.rustShard;
        player.bunker.glowDust += loot.glowDust;
        update += `${player.name} returns to bunker! Stored: ${loot.scr.toFixed(2)} SCR${loot.scrapMetal > 0 ? `, ${loot.scrapMetal} Scrap Metal` : ''}${loot.rustShard > 0 ? `, ${loot.rustShard} Rust Shard${loot.rustShard > 1 ? 's' : ''}` : ''}${loot.glowDust > 0 ? `, ${loot.glowDust} Glow Dust` : ''}\n`;
        player.active = { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 };
        collector.stop('back');
      } else if (interaction.customId === 'deeper' && player.energy >= 1) {
        player.energy -= 1;
        depth += 1;
        stage += 1;
        const deeperRoll = Math.random();
        if (deeperRoll < 0.5) {
          setEnemy(true);
          update += `Deeper into ${setting.name} (Depth ${depth}): ${enemy.name} (HP: ${enemyHp}) lunges!\n`;
        } else {
          const encounters = [
            { name: 'Radiation Surge', hpLoss: 10, scr: 0.1 },
            { name: 'Toxic Winds', hpLoss: 8, scr: 0.08 },
            { name: '_collapse Trap', hpLoss: 12, scr: 0.15 },
            { name: 'Mutant Ambush', hpLoss: 15, scr: 0.2 },
            { name: 'Hidden Cache', hpLoss: 0, scr: 0.75 }
          ];
          const encounter = encounters[Math.floor(Math.random() * encounters.length)];
          const reducedLoss = Math.floor(encounter.hpLoss * (1 - player.armor * 0.1));
          player.hp -= reducedLoss;
          loot.scr += encounter.scr * (1 + depth * 0.2);
          if (encounter.name === 'Hidden Cache') {
            if (Math.random() < 0.03) loot.scrapMetal += 1;
            else if (Math.random() < 0.03) loot.rustShard += 1;
            else if (Math.random() < 0.03) loot.glowDust += 1;
          }
          update += `Deeper into ${setting.name} (Depth ${depth}): ${encounter.name}: ${encounter.hpLoss > 0 ? `-${reducedLoss} HP` : ''}, +${(encounter.scr * (1 + depth * 0.2)).toFixed(2)} SCR${loot.scrapMetal > 0 ? ', +1 Scrap Metal' : loot.rustShard > 0 ? ', +1 Rust Shard' : loot.glowDust > 0 ? ', +1 Glow Dust' : ''}\n`;
        }
      } else if (interaction.customId === 'run') {
        player.active.scr += loot.scr;
        player.active.scrapMetal += loot.scrapMetal;
        player.active.rustShard += loot.rustShard;
        player.active.glowDust += loot.glowDust;
        update += `${player.name} flees ${setting.name}! Loot: ${loot.scr.toFixed(2)} SCR${loot.scrapMetal > 0 ? `, ${loot.scrapMetal} Scrap Metal` : ''}${loot.rustShard > 0 ? `, ${loot.rustShard} Rust Shard${loot.rustShard > 1 ? 's' : ''}` : ''}${loot.glowDust > 0 ? `, ${loot.glowDust} Glow Dust` : ''}\n`;
        collector.stop('run');
      } else if (interaction.customId === 'heal') {
        if (player.inventory.scavJuice > 0 && player.hp < 100) {
          player.hp = Math.min(100, player.hp + 20);
          player.inventory.scavJuice -= 1;
          update += `Used Scav Juice! +20 HP. HP: ${player.hp}, Scav Juice: ${player.inventory.scavJuice}\n`;
        } else {
          update += `No Scav Juice or full HP!\n`;
        }
      }

      if (player.hp <= 0) {
        update += `${player.name} dies! All active loot lost.\n`;
        player.active = { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 };
        player.lastRaid = Date.now();
        collector.stop('death');
      }

      let content = `${player.name} - ${setting.name}${depth > 0 ? ` (Depth ${depth})` : ''}\n${update}HP: ${player.hp}, Energy: ${player.energy}/5${enemyHp > 0 ? `\nEnemy HP: ${enemyHp}` : ''}\nPick an action:`;
      let components = player.hp > 0 ? 
        (enemyHp > 0 ? [getFightButtons(true)] : 
        (stage < (isDeathsHollow ? 4 : 3) ? [getFightButtons(false)] : [getChoiceButtons()])) : [];

      await raidMessage.edit({ content, components });
      saveState();
    });

    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        raidMessage.edit({ 
          content: `${player.name} stalls! Raid ends.\nHP: ${player.hp}, Energy: ${player.energy}/5, Loot: ${loot.scr.toFixed(2)} SCR${loot.scrapMetal > 0 ? `, ${loot.scrapMetal} Scrap Metal` : ''}${loot.rustShard > 0 ? `, ${loot.rustShard} Rust Shard${loot.rustShard > 1 ? 's' : ''}` : ''}${loot.glowDust > 0 ? `, ${loot.glowDust} Glow Dust` : ''}`, 
          components: [] 
        });
        saveState();
      }
    });
  }

  if (command === 'store') {
    if (!player.suiAddress) {
      message.reply('Register with !register first!');
      return;
    }
    player.bunker.scr += player.active.scr;
    player.bunker.scrapMetal += player.active.scrapMetal;
    player.bunker.rustShard += player.active.rustShard;
    player.bunker.glowDust += player.active.glowDust;
    const stored = `${player.active.scr} SCR${player.active.scrapMetal > 0 ? `, ${player.active.scrapMetal} Scrap Metal` : ''}${player.active.rustShard > 0 ? `, ${player.active.rustShard} Rust Shard${player.active.rustShard > 1 ? 's' : ''}` : ''}${player.active.glowDust > 0 ? `, ${player.active.glowDust} Glow Dust` : ''}`;
    player.active = { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 };
    message.reply(`Stored in Bunker: ${stored}\nHP: ${player.hp}, Energy: ${player.energy}/5`);
    saveState();
  }

  if (command === 'craft') {
    if (!player.suiAddress) {
      message.reply('Register with !register first!');
      return;
    }
    const type = args[0]?.toLowerCase();
    if (type === 'weapon') {
      if (player.bunker.scrapMetal < 2 || player.bunker.rustShard < 1) {
        message.reply(`Need 2 Scrap Metal + 1 Rust Shard! You have: ${player.bunker.scrapMetal} Scrap Metal, ${player.bunker.rustShard} Rust Shards`);
        return;
      }
      player.bunker.scrapMetal -= 2;
      player.bunker.rustShard -= 1;
      message.reply(`Crafted a Rust Blade! (On-chain soon)\nEquip with !equip weapon`);
    } else if (type === 'armor') {
      if (player.bunker.scrapMetal < 1 || player.bunker.glowDust < 1) {
        message.reply(`Need 1 Scrap Metal + 1 Glow Dust! You have: ${player.bunker.scrapMetal} Scrap Metal, ${player.bunker.glowDust} Glow Dust`);
        return;
      }
      player.bunker.scrapMetal -= 1;
      player.bunker.glowDust -= 1;
      message.reply(`Crafted a Glow Vest! (On-chain soon)\nEquip with !equip armor`);
    } else {
      message.reply('Usage: !craft <weapon|armor>');
      return;
    }
    saveState();
  }

  if (command === 'equip') {
    if (!player.suiAddress) {
      message.reply('Register with !register first!');
      return;
    }
    const type = args[0]?.toLowerCase();
    if (type === 'weapon') {
      player.attack = 15;
      player.equipped.weapon = true;
      message.reply(`Equipped Rust Blade! Attack: ${player.attack}`);
    } else if (type === 'armor') {
      player.armor = Math.min(3, player.armor + 1);
      player.equipped.armor = true;
      message.reply(`Equipped Glow Vest! Armor: ${player.armor * 10}%`);
    } else {
      message.reply('Usage: !equip <weapon|armor>');
      return;
    }
    saveState();
  }

  if (command === 'status') {
    if (!player.suiAddress) {
      message.reply('Register with !register first!');
      return;
    }
    const wait = player.lastRaid && (Date.now() - player.lastRaid < 60 * 60 * 1000) ? Math.ceil((60 * 60 * 1000 - (Date.now() - player.lastRaid)) / 60000) : 0;
    let stateText = `${player.name}\nHP: ${player.hp}, Attack: ${player.attack}, Armor: ${player.armor * 10}%, Energy: ${player.energy}/5${wait > 0 ? `, Cooldown: ${wait} min` : ''}\n`;
    stateText += `Active: ${player.active.scr} SCR${player.active.scrapMetal > 0 ? `, ${player.active.scrapMetal} Scrap Metal` : ''}${player.active.rustShard > 0 ? `, ${player.active.rustShard} Rust Shard${player.active.rustShard > 1 ? 's' : ''}` : ''}${player.active.glowDust > 0 ? `, ${player.active.glowDust} Glow Dust` : ''}\n`;
    stateText += `Bunker: ${player.bunker.scr} SCR${player.bunker.scrapMetal > 0 ? `, ${player.bunker.scrapMetal} Scrap Metal` : ''}${player.bunker.rustShard > 0 ? `, ${player.bunker.rustShard} Rust Shard${player.bunker.rustShard > 1 ? 's' : ''}` : ''}${player.bunker.glowDust > 0 ? `, ${player.bunker.glowDust} Glow Dust` : ''}\n`;
    stateText += `Equipped: ${player.equipped.weapon ? 'Rust Blade' : 'None'}, ${player.equipped.armor ? 'Glow Vest' : 'None'}\nScav Juice: ${player.inventory.scavJuice}`;
    message.channel.send(stateText);
  }

  if (command === 'terms') {
    message.reply(
      'Wasteland Scourge Terms of Service:\n' +
      '1. This is a game for entertainment only—no real-world value or profit is guaranteed.\n' +
      '2. NFTs minted are owned by players; we’re not liable for their use or value.\n' +
      '3. We store your Discord ID and Sui address for gameplay—data won’t be sold.\n' +
      '4. Play at your own risk; we can update or stop the game anytime.\n' +
      'Questions? DM the dev!'
    );
  }
});

function saveState() {
  fs.writeFileSync('/data/state.json', JSON.stringify(gameState, null, 2));
  console.log('Game state saved');
}

client.login(TOKEN);

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot alive');
}).listen(8080, () => console.log('Ping server on port 8080'));
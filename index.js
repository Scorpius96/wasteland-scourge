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

// Load gameState from file if it exists, otherwise start fresh
let gameState = { players: {} };
if (fs.existsSync('gameState.json')) {
  gameState = JSON.parse(fs.readFileSync('gameState.json'));
  console.log('Loaded gameState from gameState.json');
}
let nftCount = 0;

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
  }, 60 * 60 * 1000); // 1 hour regen
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  let player = gameState.players[message.author.id] || {};

  if (command === 'wsc') {
    if (!player.suiAddress) {
      const suiAddress = args[0];
      if (!suiAddress || !suiAddress.startsWith('0x') || suiAddress.length !== 66) {
        message.reply('First time? Use: !wsc <Sui Address> <Name>');
        return;
      }
      const wscCost = Math.round(2 / WSC_PRICE) * 1000000;
      try {
        console.log(`Registering ${message.author.id} with address ${suiAddress}`);
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
        await message.reply(`Registered as ${player.name} for 20 WSC! Tx: ${wscResult.digest}`);
        saveState();
      } catch (error) {
        message.reply(`Registration failed: ${error.message}\nAdmin wallet needs WSC (20M raw) and SUI gas (20M raw).`);
        console.error('Register error:', error);
        return;
      }
    }

    const mainMenu = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('raid').setLabel('RAID').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('bunker').setLabel('BUNKER').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('store').setLabel('STORE').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('wallet').setLabel('WALLET INFO').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('exit').setLabel('EXIT').setStyle(ButtonStyle.Secondary)
      );

    console.log(`Sending main menu for ${player.name}`);
    let menuMessage = await message.reply({
      content: `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`,
      components: [mainMenu]
    });

    const filter = i => i.user.id === message.author.id;
    const collector = menuMessage.createMessageComponentCollector({ filter, time: 300000 });

    collector.on('collect', async (interaction) => {
      console.log(`Button clicked by ${player.name}: ${interaction.customId}`);
      let content = '';
      let components = [];

      try {
        if (interaction.customId === 'raid') {
          const now = Date.now();
          if (now - player.lastRaid < 60 * 60 * 1000) {
            const wait = Math.ceil((60 * 60 * 1000 - (now - player.lastRaid)) / 60000);
            content = `You’re recovering from death! Wait ${wait} minutes.`;
            components = [mainMenu];
          } else if (player.hp <= 0) {
            content = `You’re dead! Regen in progress (10 HP/hour). HP: ${player.hp}`;
            components = [mainMenu];
          } else if (player.energy < 1) {
            content = `Out of energy! Regen 1 every 3 hours. Energy: ${player.energy}/5`;
            components = [mainMenu];
          } else {
            player.energy -= 1;
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
            content = `${player.name} enters ${setting.name}\n${setting.desc}\nFight: ${enemy.name} (HP: ${enemyHp}) lunges!\nHP: ${player.hp}, Energy: ${player.energy}/5\nPick an action:`;
            components = [new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder().setCustomId('attack').setLabel('Attack').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('run_raid').setLabel('Abandon Raid').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('heal').setLabel('Heal').setStyle(ButtonStyle.Success)
              )];

            await interaction.update({ content, components });
            console.log(`Raid started for ${player.name} in ${setting.name}`);

            const raidCollector = menuMessage.createMessageComponentCollector({ filter, time: 120000 });
            raidCollector.on('collect', async (raidInteraction) => {
              console.log(`Raid button clicked by ${player.name}: ${raidInteraction.customId}`);
              let raidUpdate = '';

              try {
                if (raidInteraction.customId === 'attack' && enemyHp > 0) {
                  enemyHp -= attack;
                  raidUpdate += `${player.name} hits ${enemy.name} for ${attack}. Enemy HP: ${enemyHp}\n`;
                  if (enemyHp > 0) {
                    const rawDamage = enemyAttack;
                    const reduction = player.armor * 0.1;
                    const damage = Math.floor(rawDamage * (1 - reduction));
                    player.hp -= damage;
                    raidUpdate += `${enemy.name} hits for ${damage} (reduced by ${player.armor * 10}%). HP: ${player.hp}\n`;
                  } else {
                    const scrLoot = (Math.random() * (enemy.scrMax - enemy.scrMin) + enemy.scrMin) * (1 + depth * 0.2);
                    loot.scr += scrLoot;
                    raidUpdate += `${enemy.name} falls! +${scrLoot.toFixed(2)} SCR\n`;
                  }
                } else if (raidInteraction.customId === 'continue' && enemyHp <= 0) {
                  stage += 1;
                  if (stage === 2) {
                    const scavengeScr = (Math.random() < 0.7 ? 0.1 : 0.05) * (1 + depth * 0.2);
                    loot.scr += scavengeScr;
                    if (Math.random() < 0.005) loot.scrapMetal += 1;
                    else if (Math.random() < 0.003) loot.rustShard += 1;
                    else if (Math.random() < 0.002) loot.glowDust += 1;
                    raidUpdate += `Scavenge: +${scavengeScr.toFixed(2)} SCR${loot.scrapMetal > 0 ? ', +1 Scrap Metal' : loot.rustShard > 0 ? ', +1 Rust Shard' : loot.glowDust > 0 ? ', +1 Glow Dust' : ''}\n`;
                  } else if (stage === 3 && isDeathsHollow) {
                    setEnemy();
                    raidUpdate += `Fight: ${enemy.name} (HP: ${enemyHp}) lunges!\n`;
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
                    raidUpdate += `${encounter.name}: ${encounter.hpLoss > 0 ? `-${reducedLoss} HP (reduced by ${player.armor * 10}%)` : ''}, +${(encounter.scr * (1 + depth * 0.2)).toFixed(2)} SCR${loot.scrapMetal > 0 ? ', +1 Scrap Metal' : loot.rustShard > 0 ? ', +1 Rust Shard' : loot.glowDust > 0 ? ', +1 Glow Dust' : ''}\n`;
                    if (player.hp > 0) {
                      raidUpdate += `Survived ${setting.name}! Loot so far: ${loot.scr.toFixed(2)} SCR${loot.scrapMetal > 0 ? `, ${loot.scrapMetal} Scrap Metal` : ''}${loot.rustShard > 0 ? `, ${loot.rustShard} Rust Shard${loot.rustShard > 1 ? 's' : ''}` : ''}${loot.glowDust > 0 ? `, ${loot.glowDust} Glow Dust` : ''}\n`;
                    }
                  }
                } else if (raidInteraction.customId === 'back') {
                  player.bunker.scr += loot.scr;
                  player.bunker.scrapMetal += loot.scrapMetal;
                  player.bunker.rustShard += loot.rustShard;
                  player.bunker.glowDust += loot.glowDust;
                  raidUpdate += `${player.name} returns to bunker! Stored: ${loot.scr.toFixed(2)} SCR${loot.scrapMetal > 0 ? `, ${loot.scrapMetal} Scrap Metal` : ''}${loot.rustShard > 0 ? `, ${loot.rustShard} Rust Shard${loot.rustShard > 1 ? 's' : ''}` : ''}${loot.glowDust > 0 ? `, ${loot.glowDust} Glow Dust` : ''}\n`;
                  player.active = { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 };
                  raidCollector.stop('back');
                } else if (raidInteraction.customId === 'deeper' && player.energy >= 1) {
                  player.energy -= 1;
                  depth += 1;
                  stage += 1;
                  const deeperRoll = Math.random();
                  if (deeperRoll < 0.5) {
                    setEnemy(true);
                    raidUpdate += `Deeper into ${setting.name} (Depth ${depth}): ${enemy.name} (HP: ${enemyHp}) lunges!\n`;
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
                    raidUpdate += `Deeper into ${setting.name} (Depth ${depth}): ${encounter.name}: ${encounter.hpLoss > 0 ? `-${reducedLoss} HP` : ''}, +${(encounter.scr * (1 + depth * 0.2)).toFixed(2)} SCR${loot.scrapMetal > 0 ? ', +1 Scrap Metal' : loot.rustShard > 0 ? ', +1 Rust Shard' : loot.glowDust > 0 ? ', +1 Glow Dust' : ''}\n`;
                  }
                } else if (raidInteraction.customId === 'run_raid' || raidInteraction.customId === 'run') {
                  player.active.scr += loot.scr;
                  player.active.scrapMetal += loot.scrapMetal;
                  player.active.rustShard += loot.rustShard;
                  player.active.glowDust += loot.glowDust;
                  raidUpdate += `${player.name} flees ${setting.name}! Loot: ${loot.scr.toFixed(2)} SCR${loot.scrapMetal > 0 ? `, ${loot.scrapMetal} Scrap Metal` : ''}${loot.rustShard > 0 ? `, ${loot.rustShard} Rust Shard${loot.rustShard > 1 ? 's' : ''}` : ''}${loot.glowDust > 0 ? `, ${loot.glowDust} Glow Dust` : ''}\n`;
                  raidCollector.stop('run');
                } else if (raidInteraction.customId === 'heal') {
                  if (player.inventory.scavJuice > 0 && player.hp < 100) {
                    player.hp = Math.min(100, player.hp + 20);
                    player.inventory.scavJuice -= 1;
                    raidUpdate += `Used Scav Juice! +20 HP. HP: ${player.hp}, Scav Juice: ${player.inventory.scavJuice}\n`;
                  } else {
                    raidUpdate += `No Scav Juice or full HP!\n`;
                  }
                }

                if (player.hp <= 0) {
                  raidUpdate += `${player.name} dies! All active loot lost.\n`;
                  player.active = { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 };
                  player.lastRaid = Date.now();
                  raidCollector.stop('death');
                }

                let raidContent = `${player.name} - ${setting.name}${depth > 0 ? ` (Depth ${depth})` : ''}\n${raidUpdate}HP: ${player.hp}, Energy: ${player.energy}/5${enemyHp > 0 ? `\nEnemy HP: ${enemyHp}` : ''}\nPick an action:`;
                let raidComponents = player.hp > 0 ? 
                  (enemyHp > 0 ? [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('attack').setLabel('Attack').setStyle(ButtonStyle.Primary),
                      new ButtonBuilder().setCustomId('run_raid').setLabel('Abandon Raid').setStyle(ButtonStyle.Secondary),
                      new ButtonBuilder().setCustomId('heal').setLabel('Heal').setStyle(ButtonStyle.Success)
                    )] : 
                  (stage < (isDeathsHollow ? 4 : 3) ? [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('continue').setLabel('Continue').setStyle(ButtonStyle.Primary),
                      new ButtonBuilder().setCustomId('run_raid').setLabel('Abandon Raid').setStyle(ButtonStyle.Secondary)
                    )] : [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('back').setLabel('Back to Bunker').setStyle(ButtonStyle.Primary),
                      new ButtonBuilder().setCustomId('deeper').setLabel('Continue On').setStyle(ButtonStyle.Danger).setDisabled(player.energy < 1),
                      new ButtonBuilder().setCustomId('run_raid').setLabel('Abandon Raid').setStyle(ButtonStyle.Secondary)
                    )])) : [mainMenu];

                await menuMessage.edit({ content: raidContent, components: raidComponents });
                saveState();
              } catch (error) {
                console.error(`Raid interaction error for ${player.name}:`, error);
                await raidInteraction.reply({ content: 'Raid error! Check logs.', ephemeral: true });
              }
            });

            raidCollector.on('end', (collected, reason) => {
              console.log(`Raid ended for ${player.name}. Reason: ${reason}`);
              if (reason === 'time' || reason === 'run' || reason === 'death' || reason === 'back') {
                menuMessage.edit({
                  content: reason === 'time' ? `${player.name} stalls! Raid ends.\nHP: ${player.hp}, Energy: ${player.energy}/5, Loot: ${loot.scr.toFixed(2)} SCR${loot.scrapMetal > 0 ? `, ${loot.scrapMetal} Scrap Metal` : ''}${loot.rustShard > 0 ? `, ${loot.rustShard} Rust Shard${loot.rustShard > 1 ? 's' : ''}` : ''}${loot.glowDust > 0 ? `, ${loot.glowDust} Glow Dust` : ''}` : `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`,
                  components: [mainMenu]
                });
                saveState();
              }
            });
            return;
          } else if (interaction.customId === 'bunker') {
            content = `${player.name} - Bunker Access: Secure your loot.\nPick an action:`;
            components = [new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder().setCustomId('craft').setLabel('CRAFT').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('withdraw').setLabel('WITHDRAW NFTs').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('store_assets').setLabel('STORE ASSETS').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('back').setLabel('BACK').setStyle(ButtonStyle.Secondary)
              )];

            await interaction.update({ content, components });
            console.log(`Bunker opened for ${player.name}`);

            const bunkerCollector = menuMessage.createMessageComponentCollector({ filter, time: 120000 });
            bunkerCollector.on('collect', async (bunkerInteraction) => {
              console.log(`Bunker button clicked by ${player.name}: ${bunkerInteraction.customId}`);
              let bunkerUpdate = '';

              try {
                if (bunkerInteraction.customId === 'craft') {
                  bunkerUpdate = `${player.name} - Craft Gear:\nPick an item:`;
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('craft_weapon').setLabel('Rust Blade (2 SM, 1 RS)').setStyle(ButtonStyle.Primary).setDisabled(player.bunker.scrapMetal < 2 || player.bunker.rustShard < 1),
                      new ButtonBuilder().setCustomId('craft_armor').setLabel('Glow Vest (1 SM, 1 GD)').setStyle(ButtonStyle.Primary).setDisabled(player.bunker.scrapMetal < 1 || player.bunker.glowDust < 1),
                      new ButtonBuilder().setCustomId('back_bunker').setLabel('Back').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'craft_weapon') {
                  player.bunker.scrapMetal -= 2;
                  player.bunker.rustShard -= 1;
                  bunkerUpdate = `${player.name} crafted a Rust Blade!\nConfirm:`;
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('confirm_craft_weapon').setLabel('Confirm').setStyle(ButtonStyle.Primary),
                      new ButtonBuilder().setCustomId('back_bunker').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'craft_armor') {
                  player.bunker.scrapMetal -= 1;
                  player.bunker.glowDust -= 1;
                  bunkerUpdate = `${player.name} crafted a Glow Vest!\nConfirm:`;
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('confirm_craft_armor').setLabel('Confirm').setStyle(ButtonStyle.Primary),
                      new ButtonBuilder().setCustomId('back_bunker').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'confirm_craft_weapon') {
                  if (nftCount < 50) {
                    const tx = new Transaction();
                    const nft = tx.moveCall({
                      target: '0x2::devnet_nft::mint',
                      arguments: [
                        tx.pure('RustBlade'),
                        tx.pure(`WSC RustBlade for ${player.name}`),
                        tx.pure('https://ipfs.io/ipfs/QmYourIPFSHashHere')
                      ],
                    });
                    tx.transferObjects([nft], player.suiAddress);
                    tx.setGasBudget(20000000);
                    const result = await suiClient.signAndExecuteTransaction({
                      transaction: tx,
                      signer: keypair,
                      options: { showEffects: true }
                    });
                    nftCount += 1;
                    bunkerUpdate = `Crafted and minted Rust Blade NFT (FREE for first 50 players)!\nTx: ${result.digest}\nEquip with BUNKER > CRAFT`;
                  } else {
                    bunkerUpdate = `Crafted Rust Blade! (NFT minting coming soon)\nEquip with BUNKER > CRAFT`;
                  }
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('back').setLabel('Back to Main').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'confirm_craft_armor') {
                  if (nftCount < 50) {
                    const tx = new Transaction();
                    const nft = tx.moveCall({
                      target: '0x2::devnet_nft::mint',
                      arguments: [
                        tx.pure('GlowVest'),
                        tx.pure(`WSC GlowVest for ${player.name}`),
                        tx.pure('https://ipfs.io/ipfs/QmYourIPFSHashHere')
                      ],
                    });
                    tx.transferObjects([nft], player.suiAddress);
                    tx.setGasBudget(20000000);
                    const result = await suiClient.signAndExecuteTransaction({
                      transaction: tx,
                      signer: keypair,
                      options: { showEffects: true }
                    });
                    nftCount += 1;
                    bunkerUpdate = `Crafted and minted Glow Vest NFT (FREE for first 50 players)!\nTx: ${result.digest}\nEquip with BUNKER > CRAFT`;
                  } else {
                    bunkerUpdate = `Crafted Glow Vest! (NFT minting coming soon)\nEquip with BUNKER > CRAFT`;
                  }
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('back').setLabel('Back to Main').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'withdraw') {
                  bunkerUpdate = `${player.name} - Withdraw NFTs:\nComing soon on mainnet!`;
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('back').setLabel('Back to Main').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'store_assets') {
                  player.bunker.scr += player.active.scr;
                  player.bunker.scrapMetal += player.active.scrapMetal;
                  player.bunker.rustShard += player.active.rustShard;
                  player.bunker.glowDust += player.active.glowDust;
                  bunkerUpdate = `${player.name} stored: ${player.active.scr} SCR${player.active.scrapMetal > 0 ? `, ${player.active.scrapMetal} Scrap Metal` : ''}${player.active.rustShard > 0 ? `, ${player.active.rustShard} Rust Shard${player.active.rustShard > 1 ? 's' : ''}` : ''}${player.active.glowDust > 0 ? `, ${player.active.glowDust} Glow Dust` : ''}\nConfirm:`;
                  player.active = { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 };
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('confirm_store').setLabel('Confirm').setStyle(ButtonStyle.Primary),
                      new ButtonBuilder().setCustomId('back_bunker').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'confirm_store') {
                  bunkerUpdate = `${player.name} - Assets stored in bunker!\nHP: ${player.hp}, Energy: ${player.energy}/5`;
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('back').setLabel('Back to Main').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'back_bunker') {
                  bunkerUpdate = `${player.name} - Bunker Access: Secure your loot.\nPick an action:`;
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('craft').setLabel('CRAFT').setStyle(ButtonStyle.Primary),
                      new ButtonBuilder().setCustomId('withdraw').setLabel('WITHDRAW NFTs').setStyle(ButtonStyle.Success),
                      new ButtonBuilder().setCustomId('store_assets').setLabel('STORE ASSETS').setStyle(ButtonStyle.Secondary),
                      new ButtonBuilder().setCustomId('back').setLabel('BACK').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (bunkerInteraction.customId === 'back') {
                  bunkerCollector.stop('back');
                }

                await menuMessage.edit({ content: bunkerUpdate, components });
                saveState();
              } catch (error) {
                console.error(`Bunker interaction error for ${player.name}:`, error);
                await bunkerInteraction.reply({ content: 'Bunker error! Check logs.', ephemeral: true });
              }
            });

            bunkerCollector.on('end', (collected, reason) => {
              console.log(`Bunker ended for ${player.name}. Reason: ${reason}`);
              if (reason === 'time' || reason === 'back') {
                menuMessage.edit({
                  content: `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`,
                  components: [mainMenu]
                });
                saveState();
              }
            });
            return;
          } else if (interaction.customId === 'store') {
            content = `${player.name} - Wasteland Trader: What’s your poison?\nActive SCR: ${player.active.scr}`;
            components = [new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder().setCustomId('buy_juice').setLabel('Buy Scav Juice (5 SCR)').setStyle(ButtonStyle.Primary).setDisabled(player.active.scr < 5),
                new ButtonBuilder().setCustomId('back').setLabel('BACK').setStyle(ButtonStyle.Secondary)
              )];

            await interaction.update({ content, components });
            console.log(`Store opened for ${player.name}`);

            const storeCollector = menuMessage.createMessageComponentCollector({ filter, time: 120000 });
            storeCollector.on('collect', async (storeInteraction) => {
              console.log(`Store button clicked by ${player.name}: ${storeInteraction.customId}`);
              let storeUpdate = '';

              try {
                if (storeInteraction.customId === 'buy_juice') {
                  player.active.scr -= 5;
                  player.inventory.scavJuice += 1;
                  storeUpdate = `${player.name} bought 1 Scav Juice for 5 SCR!\nScav Juice: ${player.inventory.scavJuice}`;
                  components = [new ActionRowBuilder()
                    .addComponents(
                      new ButtonBuilder().setCustomId('back').setLabel('Back to Main').setStyle(ButtonStyle.Secondary)
                    )];
                } else if (storeInteraction.customId === 'back') {
                  storeCollector.stop('back');
                }

                await menuMessage.edit({ content: storeUpdate || `${player.name} - Wasteland Trader: What’s your poison?\nActive SCR: ${player.active.scr}`, components });
                saveState();
              } catch (error) {
                console.error(`Store interaction error for ${player.name}:`, error);
                await storeInteraction.reply({ content: 'Store error! Check logs.', ephemeral: true });
              }
            });

            storeCollector.on('end', (collected, reason) => {
              console.log(`Store ended for ${player.name}. Reason: ${reason}`);
              if (reason === 'time' || reason === 'back') {
                menuMessage.edit({
                  content: `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`,
                  components: [mainMenu]
                });
                saveState();
              }
            });
            return;
          } else if (interaction.customId === 'wallet') {
            const wait = player.lastRaid && (Date.now() - player.lastRaid < 60 * 60 * 1000) ? Math.ceil((60 * 60 * 1000 - (Date.now() - player.lastRaid)) / 60000) : 0;
            content = `${player.name}’s Wasteland Ledger:\nHP: ${player.hp}, Attack: ${player.attack}, Armor: ${player.armor * 10}%, Energy: ${player.energy}/5${wait > 0 ? `, Cooldown: ${wait} min` : ''}\n` +
                      `Active: ${player.active.scr} SCR${player.active.scrapMetal > 0 ? `, ${player.active.scrapMetal} Scrap Metal` : ''}${player.active.rustShard > 0 ? `, ${player.active.rustShard} Rust Shard${player.active.rustShard > 1 ? 's' : ''}` : ''}${player.active.glowDust > 0 ? `, ${player.active.glowDust} Glow Dust` : ''}\n` +
                      `Bunker: ${player.bunker.scr} SCR${player.bunker.scrapMetal > 0 ? `, ${player.bunker.scrapMetal} Scrap Metal` : ''}${player.bunker.rustShard > 0 ? `, ${player.bunker.rustShard} Rust Shard${player.bunker.rustShard > 1 ? 's' : ''}` : ''}${player.bunker.glowDust > 0 ? `, ${player.bunker.glowDust} Glow Dust` : ''}\n` +
                      `Equipped: ${player.equipped.weapon ? 'Rust Blade' : 'None'}, ${player.equipped.armor ? 'Glow Vest' : 'None'}\nScav Juice: ${player.inventory.scavJuice}\nSui Address: ${player.suiAddress}`;
            components = [new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder().setCustomId('refresh').setLabel('REFRESH').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('back').setLabel('BACK').setStyle(ButtonStyle.Secondary)
              )];

            await interaction.update({ content, components });
            console.log(`Wallet viewed by ${player.name}`);

            const walletCollector = menuMessage.createMessageComponentCollector({ filter, time: 120000 });
            walletCollector.on('collect', async (walletInteraction) => {
              console.log(`Wallet button clicked by ${player.name}: ${walletInteraction.customId}`);
              try {
                if (walletInteraction.customId === 'refresh') {
                  const wait = player.lastRaid && (Date.now() - player.lastRaid < 60 * 60 * 1000) ? Math.ceil((60 * 60 * 1000 - (Date.now() - player.lastRaid)) / 60000) : 0;
                  content = `${player.name}’s Wasteland Ledger:\nHP: ${player.hp}, Attack: ${player.attack}, Armor: ${player.armor * 10}%, Energy: ${player.energy}/5${wait > 0 ? `, Cooldown: ${wait} min` : ''}\n` +
                            `Active: ${player.active.scr} SCR${player.active.scrapMetal > 0 ? `, ${player.active.scrapMetal} Scrap Metal` : ''}${player.active.rustShard > 0 ? `, ${player.active.rustShard} Rust Shard${player.active.rustShard > 1 ? 's' : ''}` : ''}${player.active.glowDust > 0 ? `, ${player.active.glowDust} Glow Dust` : ''}\n` +
                            `Bunker: ${player.bunker.scr} SCR${player.bunker.scrapMetal > 0 ? `, ${player.bunker.scrapMetal} Scrap Metal` : ''}${player.bunker.rustShard > 0 ? `, ${player.bunker.rustShard} Rust Shard${player.bunker.rustShard > 1 ? 's' : ''}` : ''}${player.bunker.glowDust > 0 ? `, ${player.bunker.glowDust} Glow Dust` : ''}\n` +
                            `Equipped: ${player.equipped.weapon ? 'Rust Blade' : 'None'}, ${player.equipped.armor ? 'Glow Vest' : 'None'}\nScav Juice: ${player.inventory.scavJuice}\nSui Address: ${player.suiAddress}`;
                } else if (walletInteraction.customId === 'back') {
                  walletCollector.stop('back');
                }
                await menuMessage.edit({ content: content || `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`, components: walletInteraction.customId === 'back' ? [mainMenu] : components });
                saveState();
              } catch (error) {
                console.error(`Wallet interaction error for ${player.name}:`, error);
                await walletInteraction.reply({ content: 'Wallet error! Check logs.', ephemeral: true });
              }
            });

            walletCollector.on('end', (collected, reason) => {
              console.log(`Wallet ended for ${player.name}. Reason: ${reason}`);
              if (reason === 'time' || reason === 'back') {
                menuMessage.edit({
                  content: `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`,
                  components: [mainMenu]
                });
                saveState();
              }
            });
            return;
          } else if (interaction.customId === 'exit') {
            content = `${player.name}, session ended. Type !wsc to return.`;
            components = [];
            collector.stop('exit');
          }

          await interaction.update({ content: content || `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`, components });
          saveState();
        } catch (error) {
          console.error(`Main menu interaction error for ${player.name}:`, error);
          await interaction.reply({ content: 'Something went wrong! Check logs.', ephemeral: true });
        }
      });

    collector.on('end', (collected, reason) => {
      console.log(`Main menu ended for ${player.name}. Reason: ${reason}`);
      if (reason === 'time' || reason === 'exit') {
        menuMessage.edit({
          content: `${player.name}, session ended. Type !wsc to return.`,
          components: []
        });
      }
    });
  }

  if (command === 'save') {
    console.log('Current gameState:', JSON.stringify(gameState, null, 2));
    message.reply('Game state logged to console—check Render logs or ask dev to copy it!');
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
  fs.writeFileSync('gameState.json', JSON.stringify(gameState, null, 2));
  console.log('State saved to gameState.json at', new Date().toISOString());
}

client.login(TOKEN);

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot alive');
}).listen(8080, () => console.log('Ping server on port 8080'));
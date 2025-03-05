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
  }, 60 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  let player = gameState.players[message.author.id] || {};

  if (command === 'wsc') {
    const mainMenu = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('raid').setLabel('RAID').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('bunker').setLabel('BUNKER').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('store').setLabel('STORE').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('wallet').setLabel('WALLET INFO').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('exit').setLabel('EXIT').setStyle(ButtonStyle.Secondary)
      );

    if (!player.suiAddress) {
      const suiAddress = args[0];
      if (!suiAddress || !suiAddress.startsWith('0x') || suiAddress.length !== 66) {
        await message.reply('First time? Use: !wsc <Sui Address> <Name>');
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
          suiAddress, 
          name: args[1] || `Raider_${message.author.id.slice(-4)}`, 
          hp: 100, 
          attack: 10, 
          armor: 0, 
          energy: 5, 
          equipped: { weapon: false, armor: false }, 
          active: { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 }, 
          bunker: { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 }, 
          lastRaid: 0, 
          inventory: { scavJuice: 1 } 
        };
        player = gameState.players[message.author.id];
        await message.reply(`Registered as ${player.name} for 20 WSC! Tx: ${wscResult.digest}`);
        saveState();
      } catch (error) {
        await message.reply(`Registration failed: ${error.message}\nAdmin wallet needs WSC (20M raw) and SUI gas (20M raw).`);
        console.error('Register error:', error);
        return;
      }
    }

    console.log(`Sending main menu for ${player.name}`);
    const menuMessage = await message.reply({
      content: `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`,
      components: [mainMenu]
    });

    const filter = i => i.user.id === message.author.id;
    const collector = menuMessage.createMessageComponentCollector({ filter, time: 300000 });

    collector.on('collect', async (interaction) => {
      console.log(`Button clicked by ${player.name}: ${interaction.customId}`);
      try {
        if (interaction.customId === 'raid') {
          const now = Date.now();
          if (now - player.lastRaid < 60 * 60 * 1000) {
            const wait = Math.ceil((60 * 60 * 1000 - (now - player.lastRaid)) / 60000);
            await interaction.update({ content: `${player.name}, you’re recovering from death! Wait ${wait} minutes.`, components: [mainMenu] });
          } else if (player.hp <= 0) {
            await interaction.update({ content: `${player.name}, you’re dead! Regen in progress (10 HP/hour). HP: ${player.hp}`, components: [mainMenu] });
          } else if (player.energy < 1) {
            await interaction.update({ content: `${player.name}, out of energy! Regen 1/hour. Energy: ${player.energy}/5`, components: [mainMenu] });
          } else {
            player.energy -= 1;
            const settings = [
              { name: 'City Ruins', desc: 'Crumbling towers loom...' },
              { name: 'Glowing Dunes', desc: 'Shimmering haze drifts...' },
              { name: 'Scav Shanties', desc: 'Huts creak in the wind...' },
              { name: 'Death’s Hollow', desc: 'A pit echoes with growls...' }
            ];
            const setting = settings[Math.floor(Math.random() * settings.length)];
            collector.stop('raid'); // Stop main collector before raid starts
            await handleRaid(player, interaction, menuMessage, setting);
            return;
          }
        } else if (interaction.customId === 'exit') {
          await interaction.update({ content: `${player.name}, session ended. Type !wsc to return.`, components: [] });
          collector.stop('exit');
        } else {
          await interaction.update({ content: `${player.name}, feature not implemented yet.`, components: [mainMenu] });
        }
        saveState();
      } catch (error) {
        console.error(`Main menu error for ${player.name}:`, error.stack);
        await interaction.update({ content: `${player.name}, error occurred! Try again.`, components: [mainMenu] }).catch(err => console.error('Failed to update on error:', err));
      }
    });

    collector.on('end', (collected, reason) => {
      console.log(`Main collector ended for ${player.name}. Reason: ${reason}`);
      if (reason === 'time' || reason === 'exit') {
        menuMessage.edit({
          content: `${player.name}, session ended. Type !wsc to return.`,
          components: []
        }).catch(err => console.error('Failed to edit on end:', err));
        saveState();
      }
    });
  }

  if (command === 'save') {
    console.log('Current gameState:', JSON.stringify(gameState, null, 2));
    await message.reply('Game state logged to console—check Render logs!');
    saveState();
  }
});

async function handleRaid(player, initialInteraction, menuMessage, setting) {
  console.log(`Starting raid for ${player.name} in ${setting.name}`);
  let loot = { scr: 0 };
  let enemy = { name: 'Rust Creeper', hp: 25, attack: 5, scrMin: 0.03, scrMax: 0.05 };
  let enemyHp = enemy.hp;
  const filter = i => i.user.id === initialInteraction.user.id;

  const raidMenu = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('attack').setLabel('Attack').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('run_raid').setLabel('Abandon Raid').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('heal').setLabel('Heal').setStyle(ButtonStyle.Success)
    );

  const mainMenu = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('raid').setLabel('RAID').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('bunker').setLabel('BUNKER').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('store').setLabel('STORE').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('wallet').setLabel('WALLET INFO').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('exit').setLabel('EXIT').setStyle(ButtonStyle.Secondary)
    );

  await initialInteraction.update({
    content: `${player.name} - ${setting.name}\nFight: ${enemy.name} (HP: ${enemyHp}) lunges!\nHP: ${player.hp}, Energy: ${player.energy}/5\nPick an action:`,
    components: [raidMenu()]
  });

  const collector = menuMessage.createMessageComponentCollector({ filter, time: 300000 });

  collector.on('collect', async (raidInteraction) => {
    try {
      console.log(`Raid action by ${player.name}: ${raidInteraction.customId}`);
      let raidUpdate = '';

      if (raidInteraction.customId === 'attack' && enemyHp > 0) {
        const attack = player.equipped.weapon ? player.attack + 5 : player.attack;
        enemyHp -= attack;
        raidUpdate += `${player.name} hits ${enemy.name} for ${attack}. Enemy HP: ${enemyHp}\n`;
        if (enemyHp > 0) {
          const damage = Math.floor(enemy.attack * (1 - player.armor * 0.1));
          player.hp -= damage;
          raidUpdate += `${enemy.name} hits for ${damage} (reduced by ${player.armor * 10}%). HP: ${player.hp}\n`;
        } else {
          const scrLoot = (Math.random() * (enemy.scrMax - enemy.scrMin) + enemy.scrMin);
          loot.scr += scrLoot;
          raidUpdate += `${enemy.name} falls! +${scrLoot.toFixed(2)} SCR\n`;
        }
      } else if (raidInteraction.customId === 'heal') {
        if (player.inventory.scavJuice > 0 && player.hp < 100) {
          player.hp = Math.min(100, player.hp + 20);
          player.inventory.scavJuice -= 1;
          raidUpdate += `Used Scav Juice! +20 HP. HP: ${player.hp}\n`;
        } else {
          raidUpdate += `No Scav Juice or full HP!\n`;
        }
      } else if (raidInteraction.customId === 'run_raid') {
        player.active.scr += loot.scr;
        await raidInteraction.update({
          content: `${player.name} flees ${setting.name}! Loot: ${loot.scr.toFixed(2)} SCR`,
          components: [mainMenu]
        });
        collector.stop('run');
        return;
      }

      if (player.hp <= 0) {
        raidUpdate += `${player.name} dies! All active loot lost.\n`;
        player.active = { scr: 0, scrapMetal: 0, rustShard: 0, glowDust: 0 };
        player.lastRaid = Date.now();
        await raidInteraction.update({ content: raidUpdate, components: [mainMenu] });
        collector.stop('death');
        return;
      }

      const newContent = enemyHp > 0 
        ? `${player.name} - ${setting.name}\n${raidUpdate}Fight: ${enemy.name} (HP: ${enemyHp}) lunges!\nHP: ${player.hp}, Energy: ${player.energy}/5\nPick an action:`
        : `${player.name} - ${setting.name}\n${raidUpdate}Enemy down! Loot: ${loot.scr.toFixed(2)} SCR\nHP: ${player.hp}, Energy: ${player.energy}/5\nNext move:`;
      const newComponents = enemyHp > 0 
        ? [raidMenu()]
        : [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('run_raid').setLabel('Abandon Raid').setStyle(ButtonStyle.Secondary))];

      console.log(`Updating raid menu: ${newContent}`);
      await raidInteraction.update({ content: newContent, components: newComponents });
      saveState();
    } catch (error) {
      console.error(`Raid error for ${player.name}:`, error.stack);
      await raidInteraction.update({
        content: `${player.name} - ${setting.name}\nError during raid! Returning to main menu.`,
        components: [mainMenu]
      }).catch(err => console.error('Failed to update on raid error:', err));
      collector.stop('error');
    }
  });

  collector.on('end', (collected, reason) => {
    console.log(`Raid collector ended for ${player.name}. Reason: ${reason}`);
    if (reason === 'time') {
      player.active.scr += loot.scr;
      menuMessage.edit({
        content: `${player.name} stalls! Raid ends. Loot: ${loot.scr.toFixed(2)} SCR`,
        components: [mainMenu]
      }).catch(err => console.error('Failed to edit on raid end:', err));
      saveState();
    }
  });
}

function saveState() {
  try {
    fs.writeFileSync('gameState.json', JSON.stringify(gameState, null, 2));
    console.log('State saved to gameState.json at', new Date().toISOString());
  } catch (error) {
    console.error('Failed to save gameState:', error);
  }
}

process.on('SIGINT', () => {
  console.log('Received SIGINT. Saving state and exiting...');
  saveState();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Saving state and exiting...');
  saveState();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  saveState();
  process.exit(1);
});

let isBotRunning = false;

if (!isBotRunning) {
  client.login(TOKEN).then(() => {
    isBotRunning = true;
    console.log('Bot logged in successfully');
  }).catch(err => {
    console.error('Login failed:', err);
  });
}

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot alive');
}).listen(8080, () => console.log('Ping server on port 8080 for UptimeRobot'));
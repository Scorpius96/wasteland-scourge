const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const fs = require('fs');
const http = require('http');
const path = require('path');
require('dotenv').config();

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions] 
});

const TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const WSC_COIN_TYPE = '0x0b8efbace2485175dba014eaca68556c113c111300e44155200d8ba42f93ab9d::wsc::WSC';
const WSC_PRICE = 0.10;
const ADMIN_ADDRESS = '0xdbfb5034a49be4deba3f01f1e8455148d4657f0bc4344ac5ad39c0c121f53671';
const ADMIN_ID = 'YOUR_ADMIN_ID'; // Replace with your Discord ID

const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));

const STATE_FILE_PATH = path.join('/opt/render/project/src/gameState', 'gameState.json');

let gameState = { players: {} };
if (fs.existsSync(STATE_FILE_PATH)) {
  gameState = JSON.parse(fs.readFileSync(STATE_FILE_PATH));
  console.log(`Loaded gameState from ${STATE_FILE_PATH}`);
} else {
  console.log(`No gameState file found at ${STATE_FILE_PATH}. Starting with empty state.`);
}
let nftCount = 0;

const enemies = {
  tier1: [
    { name: 'Rust Bandit', hpMin: 25, hpMax: 35, attackMin: 5, attackMax: 8, scrMin: 0.03, scrMax: 0.05, flavor: 'A wiry Schuster clad in rusted armor lunges at you!' },
    { name: 'Glow Hound', hpMin: 30, hpMax: 40, attackMin: 6, attackMax: 9, scrMin: 0.04, scrMax: 0.06, flavor: 'Its eyes pulse with a sickly green light.' },
    { name: 'Dust Wretch', hpMin: 25, hpMax: 35, attackMin: 5, attackMax: 7, scrMin: 0.05, scrMax: 0.07, flavor: 'It screeches through a cracked gas mask.' }
  ],
  tier2: [
    { name: 'Iron Maw', hpMin: 50, hpMax: 60, attackMin: 10, attackMax: 14, scrMin: 0.15, scrMax: 0.2, flavor: 'Its roar echoes through the shattered steel.' },
    { name: 'Rad Reaver', hpMin: 45, hpMax: 55, attackMin: 9, attackMax: 12, scrMin: 0.1, scrMax: 0.15, flavor: 'It grins through a haze of rad-fueled rage.' }
  ],
  tier3: [
    { name: 'Radiated Scorpion King', hpMin: 80, hpMax: 100, attackMin: 12, attackMax: 18, scrMin: 0.5, scrMax: 1.0, flavor: 'Its glowing tail arcs high, dripping venomous light!' }
  ]
};

const settings = [
  { name: 'City Ruins', desc: 'Crumbling towers loom...', weight: 40, tiers: [1, 2], image: 'https://via.placeholder.com/150?text=City+Ruins' },
  { name: 'Glowing Dunes', desc: 'Shimmering haze drifts...', weight: 30, tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Glowing+Dunes' },
  { name: 'Scav Shanties', desc: 'Huts creak in the wind...', weight: 25, tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Scav+Shanties' },
  { name: 'Death’s Hollow', desc: 'A pit echoes with growls...', weight: 5, tiers: [1, 2, 3], image: 'https://via.placeholder.com/150?text=Death’s+Hollow' }
];

const cursedLoot = [
  { name: 'Cursed Geiger Shard', bonus: '+50% SCR drops', bonusValue: 0.5, debuff: '-20% HP', debuffValue: 0.2 },
  { name: 'Cursed Rad Blade', bonus: '+5 Attack', bonusValue: 5, debuff: '-10% damage resistance', debuffValue: 0.1 }
];

function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    if (random < item.weight) return item;
    random -= item.weight;
  }
  return items[items.length - 1];
}

function getRandomEnemy(areaTiers) {
  const tier = areaTiers[Math.floor(Math.random() * areaTiers.length)];
  const enemyList = enemies[`tier${tier}`];
  const baseEnemy = enemyList[Math.floor(Math.random() * enemyList.length)];
  return {
    name: baseEnemy.name,
    hp: Math.floor(Math.random() * (baseEnemy.hpMax - baseEnemy.hpMin + 1)) + baseEnemy.hpMin,
    attackMin: baseEnemy.attackMin,
    attackMax: baseEnemy.attackMax,
    scrMin: baseEnemy.scrMin,
    scrMax: baseEnemy.scrMax,
    flavor: baseEnemy.flavor,
    tier
  };
}

function rollForCursedLoot() {
  if (Math.random() < 0.05) { // 5% chance
    return cursedLoot[Math.floor(Math.random() * cursedLoot.length)];
  }
  return null;
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const suiBalance = await suiClient.getBalance({ owner: ADMIN_ADDRESS });
  console.log(`Admin SUI Balance: ${suiBalance.totalBalance} MIST`);
  setInterval(() => {
    for (const player of Object.values(gameState.players)) {
      if (player.hp <= 0) {
        const now = Date.now();
        if (now - player.lastRaid >= 24 * 60 * 60 * 1000) {
          player.hp = 1; // Start healing after 24 hours
          player.lastRegen = now;
        }
      } else {
        const now = Date.now();
        if (!player.lastRegen) player.lastRegen = now;
        if (now - player.lastRegen >= 6 * 60 * 1000) { // 6 minutes
          player.hp = Math.min(100, player.hp + 1);
          player.lastRegen = now;
        }
        if (now - (player.lastEnergyRegen || 0) >= 60 * 60 * 1000) {
          player.energy = Math.min(5, player.energy + 1);
          player.lastEnergyRegen = now;
        }
      }
    }
    saveState();
    console.log('Regen ticked at', new Date().toISOString());
  }, 60 * 1000); // Check every minute

  setInterval(() => {
    console.log(`Bot still running at ${new Date().toISOString()}`);
  }, 60 * 60 * 1000); // Log every hour
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  let player = gameState.players[message.author.id] || {};

  if (command === 'register') {
    if (player.suiAddress) {
      await message.reply('You’re already registered! Use !menu to play.');
      return;
    }
    const suiAddress = args[0];
    if (!suiAddress || !suiAddress.startsWith('0x') || suiAddress.length !== 66) {
      await message.reply('Use: !register <Sui Address> <Name>');
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
        active: { scr: 0, scrapMetal: 0, radWaste: 0 },
        bunker: { scr: 0, scrapMetal: 0, radWaste: 0 },
        lastRaid: 0,
        lastRegen: Date.now(),
        lastEnergyRegen: Date.now(),
        inventory: { scavJuice: 0, radPill: 0, reviveStim: 0, cursedItems: [], weapons: [], armor: [], misc: [] }
      };
      player = gameState.players[message.author.id];
      await message.reply(`Registered as ${player.name} for 20 WSC! Tx: ${wscResult.digest}\nUse !menu to start playing.`);
      saveState();
    } catch (error) {
      await message.reply(`Registration failed: ${error.message}\nAdmin wallet needs WSC (20M raw) and SUI gas (20M raw).`);
      console.error('Register error:', error);
      return;
    }
  }

  if (command === 'menu') {
    if (!player.suiAddress) {
      await message.reply('You need to register first! Use: !register <Sui Address> <Name>');
      return;
    }

    const mainMenu = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('scavenge').setLabel('SCAVENGE').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('bunker').setLabel('BUNKER').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('store').setLabel('STORE').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('stats').setLabel('STATS').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('inventory').setLabel('INVENTORY').setStyle(ButtonStyle.Secondary)
      );
    const secondRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('exit').setLabel('EXIT').setStyle(ButtonStyle.Secondary)
      );

    const menuMessage = await message.reply({
      content: `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`,
      components: [mainMenu, secondRow]
    });

    await handleMenuInteraction(player, menuMessage, message.author.id);
  }

  if (command === 'save') {
    console.log('Current gameState:', JSON.stringify(gameState, null, 2));
    await message.reply('Game state logged to console—check Render logs!');
    saveState();
  }

  if (command === 'backup') {
    if (message.author.id !== ADMIN_ID) return message.reply('Admin only command.');
    const stateJson = JSON.stringify(gameState, null, 2);
    await message.reply({
      content: 'Game state backup:',
      files: [{ attachment: Buffer.from(stateJson), name: 'gameState.json' }]
    });
  }

  if (command === 'reset' && message.author.id === ADMIN_ID) {
    gameState = { players: {} };
    saveState();
    await message.reply('Game state has been reset to empty.');
  }
});

async function handleMenuInteraction(player, menuMessage, userId) {
  const filter = i => i.user.id === userId;
  const collector = menuMessage.createMessageComponentCollector({ filter, time: 300000 });

  const mainMenu = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('scavenge').setLabel('SCAVENGE').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('bunker').setLabel('BUNKER').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('store').setLabel('STORE').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stats').setLabel('STATS').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('inventory').setLabel('INVENTORY').setStyle(ButtonStyle.Secondary)
    );

  const secondRow = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('exit').setLabel('EXIT').setStyle(ButtonStyle.Secondary)
    );

  collector.on('collect', async (interaction) => {
    try {
      console.log(`Button clicked by ${player.name} (ID: ${interaction.user.id}): ${interaction.customId}`);

      if (interaction.customId === 'scavenge') {
        const now = Date.now();
        if (player.hp <= 0) {
          const timeSinceDeath = now - player.lastRaid;
          if (timeSinceDeath < 24 * 60 * 60 * 1000) {
            const waitRemaining = Math.ceil((24 * 60 * 60 * 1000 - timeSinceDeath) / (60 * 60 * 1000));
            await interaction.update({ content: `${player.name}, you’re dead! Wait ${waitRemaining} hours to respawn or use a Revive Stim from the store.`, components: [mainMenu(), secondRow()] });
            return;
          }
        }
        if (player.energy < 1) {
          await interaction.update({ content: `${player.name}, out of energy! Regen 1/hour. Energy: ${player.energy}/5`, components: [mainMenu(), secondRow()] });
          return;
        }
        player.energy -= 1;
        const setting = weightedRandom(settings);
        collector.stop('scavenge');
        await handleRaid(player, interaction, menuMessage, setting, 1, userId);
        return;
      } else if (interaction.customId === 'bunker') {
        const bunkerMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('deposit').setLabel('Deposit Loot').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('craft').setLabel('Craft').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('sui_wallet').setLabel('Sui Wallet').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('purify').setLabel('Purify Cursed Items').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `${player.name}, welcome to your Bunker.\nActive Loot: ${player.active.scr.toFixed(2)} SCR, ${player.active.scrapMetal || 0} Scrap Metal, ${player.active.radWaste || 0} Rad Waste\nBunker Storage: ${player.bunker.scr.toFixed(2)} SCR, ${player.bunker.scrapMetal || 0} Scrap Metal, ${player.bunker.radWaste || 0} Rad Waste`,
          components: [bunkerMenu]
        });
      } else if (interaction.customId === 'deposit') {
        player.bunker.scr += player.active.scr;
        player.bunker.scrapMetal = (player.bunker.scrapMetal || 0) + (player.active.scrapMetal || 0);
        player.bunker.radWaste = (player.bunker.radWaste || 0) + (player.active.radWaste || 0);
        player.active.scr = 0;
        player.active.scrapMetal = 0;
        player.active.radWaste = 0;
        await interaction.update({
          content: `${player.name}, loot deposited.\nBunker Storage: ${player.bunker.scr.toFixed(2)} SCR, ${player.bunker.scrapMetal || 0} Scrap Metal, ${player.bunker.radWaste || 0} Rad Waste`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
          )]
        });
      } else if (interaction.customId === 'sui_wallet') {
        try {
          const suiBalance = await suiClient.getBalance({ owner: player.suiAddress });
          const wscBalance = await suiClient.getBalance({ owner: player.suiAddress, coinType: WSC_COIN_TYPE });
          await interaction.update({
            content: `${player.name}, your Sui Wallet:\nSUI Balance: ${(suiBalance.totalBalance / 1e9).toFixed(2)} SUI\nWSC Balance: ${(wscBalance.totalBalance / 1e6).toFixed(2)} WSC`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
            )]
          });
        } catch (error) {
          console.error('Error fetching wallet balance:', error);
          await interaction.update({
            content: `${player.name}, error fetching wallet balance: ${error.message}`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
            )]
          });
        }
      } else if (interaction.customId === 'craft') {
        const craftMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('craft_tattered_clothes').setLabel('Craft Tattered Clothes (5 Scrap Metal, 2 Rad Waste)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_rusty_blade').setLabel('Craft Rusty Blade (10 Scrap Metal, 5 Rad Waste)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `${player.name}, crafting options:\nBunker Scrap Metal: ${player.bunker.scrapMetal || 0}\nBunker Rad Waste: ${player.bunker.radWaste || 0}`,
          components: [craftMenu]
        });
      } else if (interaction.customId === 'craft_tattered_clothes') {
        if ((player.bunker.scrapMetal || 0) >= 5 && (player.bunker.radWaste || 0) >= 2) {
          player.bunker.scrapMetal -= 5;
          player.bunker.radWaste -= 2;
          if (!player.inventory.armor) player.inventory.armor = [];
          player.inventory.armor.push({ name: 'Tattered Clothes', armorBonus: 1 });
          await interaction.update({
            content: `${player.name}, crafted Tattered Clothes (+1 Armor)!`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('craft').setLabel('Back to Craft').setStyle(ButtonStyle.Primary)
            )]
          });
        } else {
          await interaction.update({
            content: `${player.name}, not enough materials! Need 5 Scrap Metal (have ${player.bunker.scrapMetal || 0}), 2 Rad Waste (have ${player.bunker.radWaste || 0}).`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('craft').setLabel('Back to Craft').setStyle(ButtonStyle.Primary)
            )]
          });
        }
      } else if (interaction.customId === 'craft_rusty_blade') {
        if ((player.bunker.scrapMetal || 0) >= 10 && (player.bunker.radWaste || 0) >= 5) {
          player.bunker.scrapMetal -= 10;
          player.bunker.radWaste -= 5;
          if (!player.inventory.weapons) player.inventory.weapons = [];
          player.inventory.weapons.push({ name: 'Rusty Blade', attackBonus: 5 });
          await interaction.update({
            content: `${player.name}, crafted a Rusty Blade (+5 Attack)!`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('craft').setLabel('Back to Craft').setStyle(ButtonStyle.Primary)
            )]
          });
        } else {
          await interaction.update({
            content: `${player.name}, not enough materials! Need 10 Scrap Metal (have ${player.bunker.scrapMetal || 0}), 5 Rad Waste (have ${player.bunker.radWaste || 0}).`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('craft').setLabel('Back to Craft').setStyle(ButtonStyle.Primary)
            )]
          });
        }
      } else if (interaction.customId === 'purify') {
        if (!player.inventory.cursedItems || player.inventory.cursedItems.length === 0) {
          await interaction.update({
            content: `${player.name}, no cursed items to purify!`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
            )]
          });
          return;
        }
        const rows = [];
        let currentRow = new ActionRowBuilder();
        player.inventory.cursedItems.forEach((item, index) => {
          if (!item.purified) {
            if (currentRow.components.length >= 5) {
              rows.push(currentRow);
              currentRow = new ActionRowBuilder();
            }
            currentRow.addComponents(
              new ButtonBuilder().setCustomId(`purify_${index}`).setLabel(`Purify ${item.name} (5 SCR)`).setStyle(ButtonStyle.Secondary)
            );
          }
        });
        if (currentRow.components.length > 0) {
          currentRow.addComponents(
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
          rows.push(currentRow);
        } else {
          rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          ));
        }
        await interaction.update({
          content: `${player.name}, select a cursed item to purify:`,
          components: rows
        });
      } else if (interaction.customId.startsWith('purify_')) {
        const index = parseInt(interaction.customId.split('_')[1]);
        const item = player.inventory.cursedItems[index];
        if (player.bunker.scr >= 5) {
          player.bunker.scr -= 5;
          item.purified = true;
          await interaction.update({
            content: `${player.name}, purified ${item.name}! (${item.bonus} now active without debuff)`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
            )]
          });
        } else {
          await interaction.update({
            content: `${player.name}, not enough SCR! Need 5, have ${player.bunker.scr.toFixed(2)}.`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
            )]
          });
        }
      } else if (interaction.customId === 'store') {
        const storeMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('buy_scav_juice').setLabel('Buy Scav Juice (5 SCR)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_rad_pill').setLabel('Buy Rad Pill (3 SCR)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_revive_stim').setLabel('Buy Revive Stim (10 SCR)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `${player.name}, welcome to the Store.\nBunker SCR: ${player.bunker.scr.toFixed(2)}`,
          components: [storeMenu]
        });
      } else if (interaction.customId === 'buy_scav_juice') {
        if (player.bunker.scr >= 5) {
          player.bunker.scr -= 5;
          player.inventory.scavJuice = (player.inventory.scavJuice || 0) + 1;
          await interaction.update({
            content: `${player.name}, bought a Scav Juice! Inventory: ${player.inventory.scavJuice} Scav Juice`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary)
            )]
          });
        } else {
          await interaction.update({
            content: `${player.name}, not enough SCR! Need 5, have ${player.bunker.scr.toFixed(2)}.`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary)
            )]
          });
        }
      } else if (interaction.customId === 'buy_rad_pill') {
        if (player.bunker.scr >= 3) {
          player.bunker.scr -= 3;
          player.inventory.radPill = (player.inventory.radPill || 0) + 1;
          await interaction.update({
            content: `${player.name}, bought a Rad Pill! Inventory: ${player.inventory.radPill} Rad Pills`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary)
            )]
          });
        } else {
          await interaction.update({
            content: `${player.name}, not enough SCR! Need 3, have ${player.bunker.scr.toFixed(2)}.`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary)
            )]
          });
        }
      } else if (interaction.customId === 'buy_revive_stim') {
        if (player.bunker.scr >= 10) {
          player.bunker.scr -= 10;
          player.inventory.reviveStim = (player.inventory.reviveStim || 0) + 1;
          await interaction.update({
            content: `${player.name}, bought a Revive Stim! Inventory: ${player.inventory.reviveStim} Revive Stims`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary)
            )]
          });
        } else {
          await interaction.update({
            content: `${player.name}, not enough SCR! Need 10, have ${player.bunker.scr.toFixed(2)}.`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary)
            )]
          });
        }
      } else if (interaction.customId === 'stats') {
        await interaction.update({
          content: `${player.name}, your stats:\nHP: ${player.hp}/100\nAttack: ${player.attack}\nArmor: ${player.armor} (reduces damage by ${player.armor * 10}%)\nEnergy: ${player.energy}/5`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          )]
        });
      } else if (interaction.customId === 'inventory') {
        const invMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('inv_armor').setLabel('Armor').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('inv_weapons').setLabel('Weapons').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('inv_healing').setLabel('Healing').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('inv_misc').setLabel('Misc').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `${player.name}, your inventory:\nSelect a category to view items.`,
          components: [invMenu]
        });
      } else if (interaction.customId === 'inv_armor') {
        const inv = player.inventory;
        const armorItems = inv.armor ? inv.armor.map((a, i) => `${i + 1}. ${a.name} (+${a.armorBonus} Armor)`).join('\n') : 'None';
        const invMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('equip').setLabel('Equip Item').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `${player.name}, your armor:\n${armorItems}`,
          components: [invMenu]
        });
      } else if (interaction.customId === 'inv_weapons') {
        const inv = player.inventory;
        const weapons = inv.weapons ? inv.weapons.map((w, i) => `${i + 1}. ${w.name} (+${w.attackBonus} Attack)`).join('\n') : 'None';
        const invMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('equip').setLabel('Equip Item').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `${player.name}, your weapons:\n${weapons}`,
          components: [invMenu]
        });
      } else if (interaction.customId === 'inv_healing') {
        const inv = player.inventory;
        const healingItems = `Scav Juice: ${inv.scavJuice || 0}\nRad Pills: ${inv.radPill || 0}\nRevive Stims: ${inv.reviveStim || 0}`;
        const invMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('use_revive_stim').setLabel('Use Revive Stim').setStyle(ButtonStyle.Success).setDisabled(!(player.hp <= 0 && inv.reviveStim > 0)),
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `${player.name}, your healing items:\n${healingItems}`,
          components: [invMenu]
        });
      } else if (interaction.customId === 'inv_misc') {
        const inv = player.inventory;
        const miscItems = inv.misc ? inv.misc.map((m, i) => `${i + 1}. ${m.name}`).join('\n') : 'None';
        const invMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `${player.name}, your misc items:\n${miscItems}`,
          components: [invMenu]
        });
      } else if (interaction.customId === 'use_revive_stim') {
        if (player.hp <= 0 && player.inventory.reviveStim > 0) {
          player.hp = 1;
          player.inventory.reviveStim -= 1;
          player.lastRegen = Date.now();
          await interaction.update({
            content: `${player.name}, used a Revive Stim! HP restored to 1. Inventory: ${player.inventory.reviveStim} Revive Stims remaining.`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
            )]
          });
        } else {
          await interaction.update({
            content: `${player.name}, you can only use a Revive Stim when dead and if you have one!`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
            )]
          });
        }
      } else if (interaction.customId === 'equip') {
        const rows = [];
        let equipMenu = new ActionRowBuilder();
        let componentCount = 0;

        if (player.inventory.weapons && player.inventory.weapons.length > 0) {
          player.inventory.weapons.forEach((w, i) => {
            if (componentCount >= 5) {
              rows.push(equipMenu);
              equipMenu = new ActionRowBuilder();
              componentCount = 0;
            }
            equipMenu.addComponents(
              new ButtonBuilder().setCustomId(`equip_weapon_${i}`).setLabel(`Equip ${w.name}`).setStyle(ButtonStyle.Primary)
            );
            componentCount++;
          });
        }

        if (player.inventory.armor && player.inventory.armor.length > 0) {
          player.inventory.armor.forEach((a, i) => {
            if (componentCount >= 5) {
              rows.push(equipMenu);
              equipMenu = new ActionRowBuilder();
              componentCount = 0;
            }
            equipMenu.addComponents(
              new ButtonBuilder().setCustomId(`equip_armor_${i}`).setLabel(`Equip ${a.name}`).setStyle(ButtonStyle.Primary)
            );
            componentCount++;
          });
        }

        if (equipMenu.components.length > 0) {
          if (equipMenu.components.length < 5) {
            equipMenu.addComponents(
              new ButtonBuilder().setCustomId('inventory').setLabel('Back').setStyle(ButtonStyle.Secondary)
            );
          }
          rows.push(equipMenu);
        } else {
          rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('inventory').setLabel('Back').setStyle(ButtonStyle.Secondary)
          ));
        }

        await interaction.update({
          content: `${player.name}, select an item to equip:`,
          components: rows
        });
      } else if (interaction.customId.startsWith('equip_weapon_')) {
        const index = parseInt(interaction.customId.split('_')[2]);
        const weapon = player.inventory.weapons[index];
        player.equipped.weapon = weapon;
        player.attack = 10 + weapon.attackBonus;
        await interaction.update({
          content: `${player.name}, equipped ${weapon.name}! Attack: ${player.attack}`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          )]
        });
      } else if (interaction.customId.startsWith('equip_armor_')) {
        const index = parseInt(interaction.customId.split('_')[2]);
        const armor = player.inventory.armor[index];
        player.equipped.armor = armor;
        player.armor = armor.armorBonus;
        await interaction.update({
          content: `${player.name}, equipped ${armor.name}! Armor: ${player.armor} (reduces damage by ${player.armor * 10}%)`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          )]
        });
      } else if (interaction.customId === 'back') {
        await interaction.update({
          content: `${player.name}, welcome to the Wasteland Terminal.\nChoose your action:`,
          components: [mainMenu(), secondRow()]
        });
      } else if (interaction.customId === 'exit') {
        await interaction.update({ content: `${player.name}, session ended. Type !menu to return.`, components: [] });
        collector.stop('exit');
      }
      saveState();
    } catch (error) {
      console.error(`Menu error for ${player.name}:`, error.stack);
      await interaction.deferUpdate().catch(() => {});
      await interaction.message.delete().catch(() => {});
      await message.channel.send(`${player.name}, an interaction failed! Please use !menu to start again.`);
    }
  });

  collector.on('end', (collected, reason) => {
    console.log(`Main collector ended for ${player.name}. Reason: ${reason}`);
    if (reason === 'time' || reason === 'exit') {
      menuMessage.edit({
        content: `${player.name}, session ended. Type !menu to return.`,
        components: []
      }).catch(err => console.error('Failed to edit on end:', err));
      saveState();
    }
  });
}

async function handleRaid(player, initialInteraction, menuMessage, setting, encounterCount, userId) {
  console.log(`Starting scavenge for ${player.name} in ${setting.name}, encounter ${encounterCount}`);
  let loot = { scr: 0, scrapMetal: 0, radWaste: 0 };
  let enemy = getRandomEnemy(setting.tiers);
  let enemyHp = enemy.hp;
  let hasScavenged = false;
  const filter = i => i.user.id === userId;

  const raidMenu = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('attack').setLabel('Attack').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('run_raid').setLabel('Abandon Scavenge').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('heal').setLabel('Heal').setStyle(ButtonStyle.Success)
    );

  const mainMenu = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('scavenge').setLabel('SCAVENGE').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('bunker').setLabel('BUNKER').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('store').setLabel('STORE').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stats').setLabel('STATS').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('inventory').setLabel('INVENTORY').setStyle(ButtonStyle.Secondary)
    );

  const secondRow = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('exit').setLabel('EXIT').setStyle(ButtonStyle.Secondary)
    );

  const scavengeMenu = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('scavenge_loot').setLabel('Scavenge for Loot').setStyle(ButtonStyle.Primary)
    );

  const postScavengeMenu = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('go_further').setLabel('Go Further').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('back_to_bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
    );

  await initialInteraction.update({
    content: `${player.name} - ${setting.name}\n${enemy.flavor}\nFight: ${enemy.name} (HP: ${enemyHp}) lunges!\nHP: ${player.hp}, Energy: ${player.energy}/5\nPick an action:`,
    embeds: [{ image: { url: setting.image } }],
    components: [raidMenu()]
  });

  const collector = menuMessage.createMessageComponentCollector({ filter, time: 300000 });

  collector.on('collect', async (raidInteraction) => {
    try {
      console.log(`Scavenge action by ${player.name}: ${raidInteraction.customId}`);
      let raidUpdate = '';

      if (raidInteraction.customId === 'attack' && enemyHp > 0) {
        const attack = player.equipped.weapon ? player.attack + 5 : player.attack;
        enemyHp -= attack;
        raidUpdate += `${player.name} hits ${enemy.name} for ${attack}. Enemy HP: ${enemyHp}\n`;
        if (enemyHp > 0) {
          const damage = Math.floor((Math.random() * (enemy.attackMax - enemy.attackMin + 1)) + enemy.attackMin);
          const damageReduction = player.armor * 0.1;
          const finalDamage = Math.max(0, Math.floor(damage * (1 - damageReduction)));
          player.hp -= finalDamage;
          raidUpdate += `${enemy.name} hits for ${finalDamage} (reduced by ${Math.floor(damageReduction * 100)}%). HP: ${player.hp}\n`;
        } else {
          let scrLoot = (Math.random() * (enemy.scrMax - enemy.scrMin) + enemy.scrMin);
          loot.scr += scrLoot;
          raidUpdate += `${enemy.name} falls! +${scrLoot.toFixed(2)} SCR\n`;
          if (enemy.name === 'Radiated Scorpion King') {
            if (!player.inventory.misc) player.inventory.misc = [];
            player.inventory.misc.push({ name: 'Scorpion King’s Tail', description: 'An epic trophy from the Radiated Scorpion King.' });
            raidUpdate += `You obtained the epic Scorpion King’s Tail!\n`;
          }
          const cursedItem = rollForCursedLoot();
          if (cursedItem) {
            if (!player.inventory.cursedItems) player.inventory.cursedItems = [];
            player.inventory.cursedItems.push({ ...cursedItem, purified: false });
            raidUpdate += `You found a ${cursedItem.name}! (${cursedItem.bonus}, but ${cursedItem.debuff})\n`;
          }
        }
      } else if (raidInteraction.customId === 'heal') {
        if (player.inventory.scavJuice > 0 && player.hp < 100) {
          player.hp = Math.min(100, player.hp + 20);
          player.inventory.scavJuice -= 1;
          raidUpdate += `Used Scav Juice! +20 HP. HP: ${player.hp}\n`;
        } else if (player.inventory.radPill > 0) {
          player.hp = Math.min(100, player.hp + 10);
          player.inventory.radPill -= 1;
          raidUpdate += `Used Rad Pill! +10 HP. HP: ${player.hp}\n`;
        } else {
          raidUpdate += `No Scav Juice or Rad Pills available!\n`;
        }
      } else if (raidInteraction.customId === 'run_raid') {
        player.active.scr += loot.scr;
        player.active.scrapMetal = (player.active.scrapMetal || 0) + loot.scrapMetal;
        player.active.radWaste = (player.active.radWaste || 0) + loot.radWaste;
        await raidInteraction.update({
          content: `${player.name} flees ${setting.name}! Loot: ${loot.scr.toFixed(2)} SCR, ${loot.scrapMetal} Scrap Metal, ${loot.radWaste} Rad Waste`,
          embeds: [{ image: { url: setting.image } }],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('back_to_bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
            )
          ]
        });
        return; // Exit the collector to prevent further interactions on this message
      } else if (raidInteraction.customId === 'scavenge_loot') {
        const additionalScr = (Math.random() * 0.05).toFixed(2);
        const scrapChance = Math.random() < 0.5 ? Math.floor(Math.random() * 2) + 1 : 0;
        const radWasteChance = Math.random() < 0.5 ? Math.floor(Math.random() * 2) + 1 : 0;
        loot.scr += parseFloat(additionalScr);
        loot.scrapMetal += scrapChance;
        loot.radWaste += radWasteChance;
        player.active.scr += loot.scr;
        player.active.scrapMetal = (player.active.scrapMetal || 0) + loot.scrapMetal;
        player.active.radWaste = (player.active.radWaste || 0) + loot.radWaste;
        hasScavenged = true;
        await raidInteraction.update({
          content: `${player.name} scavenges the area...\nFound ${additionalScr} SCR, ${scrapChance} Scrap Metal, ${radWasteChance} Rad Waste.\nTotal Loot: ${player.active.scr.toFixed(2)} SCR, ${player.active.scrapMetal} Scrap Metal, ${player.active.radWaste} Rad Waste\nWhat next?`,
          embeds: [{ image: { url: setting.image } }],
          components: [postScavengeMenu()]
        });
        return;
      } else if (raidInteraction.customId === 'go_further') {
        await raidInteraction.deferUpdate();
        const isDeathsHollow = setting.name === 'Death’s Hollow';
        const encounterLimit = isDeathsHollow ? 3 : 2;
        if (encounterCount >= encounterLimit) {
          await raidInteraction.editReply({
            content: `${player.name}, you've ventured far enough in ${setting.name}. Time to head back!`,
            embeds: [{ image: { url: setting.image } }],
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('back_to_bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
              )
            ]
          });
          collector.stop('end');
          return;
        }
        const chance = Math.random();
        if (chance < 0.01) { // 1% chance of Loot Cache
          const cacheScr = (Math.random() * 1 + 1).toFixed(2);
          const cacheScrap = Math.floor(Math.random() * 6) + 5;
          const cacheRadWaste = Math.floor(Math.random() * 6) + 5;
          loot.scr += parseFloat(cacheScr);
          loot.scrapMetal += cacheScrap;
          loot.radWaste += cacheRadWaste;
          let cacheMessage = `${player.name}, you stumble upon a hidden Loot Cache!\nFound ${cacheScr} SCR, ${cacheScrap} Scrap Metal, ${cacheRadWaste} Rad Waste`;
          if (Math.random() < 0.001) { // 0.1% chance of item
            const items = [
              { name: 'Tattered Clothes', armorBonus: 1 },
              { name: 'Rusty Blade', attackBonus: 5 }
            ];
            const randomItem = items[Math.floor(Math.random() * items.length)];
            if (randomItem.name === 'Tattered Clothes') {
              if (!player.inventory.armor) player.inventory.armor = [];
              player.inventory.armor.push(randomItem);
            } else {
              if (!player.inventory.weapons) player.inventory.weapons = [];
              player.inventory.weapons.push(randomItem);
            }
            cacheMessage += `\nAnd a rare ${randomItem.name}!`;
          }
          player.active.scr += loot.scr;
          player.active.scrapMetal = (player.active.scrapMetal || 0) + loot.scrapMetal;
          player.active.radWaste = (player.active.radWaste || 0) + loot.radWaste;
          await raidInteraction.editReply({
            content: cacheMessage + `\nTotal Loot: ${player.active.scr.toFixed(2)} SCR, ${player.active.scrapMetal} Scrap Metal, ${player.active.radWaste} Rad Waste\nWhat next?`,
            embeds: [{ image: { url: setting.image } }],
            components: [postScavengeMenu()]
          });
          return;
        } else if (chance < 0.71) { // 70% chance of another enemy
          encounterCount++;
          enemy = getRandomEnemy(setting.tiers);
          enemyHp = enemy.hp;
          hasScavenged = false;
          await raidInteraction.editReply({
            content: `${player.name} - ${setting.name}\n${enemy.flavor}\nFight: ${enemy.name} (HP: ${enemyHp}) lunges!\nHP: ${player.hp}, Energy: ${player.energy}/5\nPick an action:`,
            embeds: [{ image: { url: setting.image } }],
            components: [raidMenu()]
          });
          return;
        } else { // 30% chance of a hazard
          const hazardDamage = 5;
          player.hp = Math.max(0, player.hp - hazardDamage);
          if (player.hp <= 0) {
            player.active = { scr: 0, scrapMetal: 0, radWaste: 0 };
            player.lastRaid = Date.now();
            await raidInteraction.editReply({
              content: `${player.name}, a Rad Storm hits, dealing ${hazardDamage} damage! You collapse...\nAll active loot lost.`,
              embeds: [{ image: { url: setting.image } }],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId('back_to_bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
                )
              ]
            });
            collector.stop('death');
            return;
          }
          await raidInteraction.editReply({
            content: `${player.name}, a Rad Storm hits, dealing ${hazardDamage} damage! HP: ${player.hp}\nWhat next?`,
            embeds: [{ image: { url: setting.image } }],
            components: [postScavengeMenu()]
          });
          return;
        }
      } else if (raidInteraction.customId === 'back_to_bunker') {
        const bunkerMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('deposit').setLabel('Deposit Loot').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('craft').setLabel('Craft').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('sui_wallet').setLabel('Sui Wallet').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('purify').setLabel('Purify Cursed Items').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
        await raidInteraction.update({
          content: `${player.name}, welcome to your Bunker.\nActive Loot: ${player.active.scr.toFixed(2)} SCR, ${player.active.scrapMetal || 0} Scrap Metal, ${player.active.radWaste || 0} Rad Waste\nBunker Storage: ${player.bunker.scr.toFixed(2)} SCR, ${player.bunker.scrapMetal || 0} Scrap Metal, ${player.bunker.radWaste || 0} Rad Waste`,
          embeds: [],
          components: [bunkerMenu]
        });
        collector.stop('end');
        return;
      }

      if (player.hp <= 0) {
        raidUpdate += `${player.name} dies! All active loot lost.\n`;
        player.active = { scr: 0, scrapMetal: 0, radWaste: 0 };
        player.lastRaid = Date.now();
        await raidInteraction.update({
          content: raidUpdate,
          embeds: [{ image: { url: setting.image } }],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('back_to_bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
            )
          ]
        });
        collector.stop('death');
        return;
      }

      const newContent = enemyHp > 0 
        ? `${player.name} - ${setting.name}\n${raidUpdate}Fight: ${enemy.name} (HP: ${enemyHp}) lunges!\nHP: ${player.hp}, Energy: ${player.energy}/5\nPick an action:`
        : `${player.name} - ${setting.name}\n${raidUpdate}Please scavenge the area before proceeding.`;
      const newComponents = enemyHp > 0 
        ? [raidMenu()]
        : encounterCount === 1 && !hasScavenged
          ? [scavengeMenu()]
          : [postScavengeMenu()];

      await raidInteraction.update({
        content: newContent,
        embeds: [{ image: { url: setting.image } }],
        components: newComponents
      });
      saveState();
    } catch (error) {
      console.error(`Scavenge error for ${player.name}:`, error.stack);
      await raidInteraction.deferUpdate().catch(() => {});
      await menuMessage.delete().catch(() => {});
      await menuMessage.channel.send(`${player.name}, an interaction failed! Please use !menu to start again.`);
      collector.stop('error');
    }
  });

  collector.on('end', (collected, reason) => {
    console.log(`Scavenge collector ended for ${player.name}. Reason: ${reason}`);
    if (reason === 'time') {
      player.active.scrapMetal = (player.active.scrapMetal || 0) + loot.scrapMetal;
      player.active.radWaste = (player.active.radWaste || 0) + loot.radWaste;
      menuMessage.edit({
        content: `${player.name} stalls! Scavenge ends. Loot: ${loot.scr.toFixed(2)} SCR, ${loot.scrapMetal} Scrap Metal, ${loot.radWaste} Rad Waste`,
        embeds: [{ image: { url: setting.image } }],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('back_to_bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success)
          )
        ]
      }).catch(err => console.error('Failed to edit on scavenge end:', err));
      saveState();
    }
  });
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE_PATH), { recursive: true });
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(gameState, null, 2));
    console.log(`State saved to ${STATE_FILE_PATH} at ${new Date().toISOString()}`);
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
}).listen(8080, () => console.log('Ping server on port 8080 for Render'));
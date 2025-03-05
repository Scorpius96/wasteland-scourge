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

// Use testnet for now, switch to mainnet for launch
const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));

let gameState = { players: {} };
if (fs.existsSync('gameState.json')) {
  gameState = JSON.parse(fs.readFileSync('gameState.json'));
  console.log('Loaded gameState from gameState.json');
}
let nftCount = 0;

// Define enemies with increased difficulty
const enemies = {
  tier1: [
    { name: 'Rust Bandit', hpMin: 25, hpMax: 35, attackMin: 5, attackMax: 8, scrMin: 0.03, scrMax: 0.05, flavor: 'A wiry figure clad in rusted armor lunges at you!' },
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

// Define areas with weighted probabilities and image URLs (placeholders)
const settings = [
  { name: 'City Ruins', desc: 'Crumbling towers loom...', weight: 40, tiers: [1, 2], image: 'https://via.placeholder.com/150?text=City+Ruins' },
  { name: 'Glowing Dunes', desc: 'Shimmering haze drifts...', weight: 30, tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Glowing+Dunes' },
  { name: 'Scav Shanties', desc: 'Huts creak in the wind...', weight: 25, tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Scav+Shanties' },
  { name: 'Death’s Hollow', desc: 'A pit echoes with growls...', weight: 5, tiers: [1, 2, 3], image: 'https://via.placeholder.com/150?text=Death’s+Hollow' }
];

// Define Cursed Loot
const cursedLoot = [
  { name: 'Cursed Geiger Shard', bonus: '+50% SCR drops', bonusValue: 0.5, debuff: '-20% HP', debuffValue: 0.2 },
  { name: 'Cursed Rad Blade', bonus: '+5 Attack', bonusValue: 5, debuff: '-10% damage resistance', debuffValue: 0.1 }
];

// Helper functions
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
  // Health regeneration: 1 HP every 6 minutes (10 HP/hour)
  setInterval(() => {
    for (const player of Object.values(gameState.players)) {
      if (player.hp <= 0) {
        // If dead, check if 24-hour wait period is over
        const now = Date.now();
        if (now - player.lastRaid >= 24 * 60 * 60 * 1000) {
          player.hp = 1; // Start healing after 24 hours
          player.lastRegen = now;
        }
      } else {
        // If alive, heal 1 HP every 6 minutes
        const now = Date.now();
        if (!player.lastRegen) player.lastRegen = now;
        if (now - player.lastRegen >= 6 * 60 * 1000) { // 6 minutes
          player.hp = Math.min(100, player.hp + 1);
          player.lastRegen = now;
        }
        // Energy regen: 1 per hour
        if (now - (player.lastEnergyRegen || 0) >= 60 * 60 * 1000) {
          player.energy = Math.min(5, player.energy + 1);
          player.lastEnergyRegen = now;
        }
      }
    }
    saveState();
    console.log('Regen ticked at', new Date().toISOString());
  }, 60 * 1000); // Check every minute
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  let player = gameState.players[message.author.id] || {};

  // Handle both !register and !wsc for registration
  if (command === 'register' || command === 'wsc') {
    if (player.suiAddress) {
      await message.reply('You’re already registered! Use !menu to play.');
      return;
    }
    const suiAddress = args[0];
    if (!suiAddress || !suiAddress.startsWith('0x') || suiAddress.length !== 66) {
      await message.reply('Use: !register <Sui Address> <Name> or !wsc <Sui Address> <Name>');
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
        inventory: { scavJuice: 0, radPill: 0, cursedItems: [], weapons: [], armor: [], misc: [] }
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
      await message.reply('You need to register first! Use: !register <Sui Address> <Name> or !wsc <Sui Address> <Name>');
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

    const filter = i => i.user.id === message.author.id;
    const collector = menuMessage.createMessageComponentCollector({ filter, time: 300000 });

    collector.on('collect', async (interaction) => {
      console.log(`Button clicked by ${player.name}: ${interaction.customId}`);
      try {
        if (interaction.customId === 'scavenge') {
          const now = Date.now();
          if (player.hp <= 0) {
            const timeSinceDeath = now - player.lastRaid;
            if (timeSinceDeath < 24 * 60 * 60 * 1000) {
              const waitRemaining = Math.ceil((24 * 60 * 60 * 1000 - timeSinceDeath) / (60 * 1000));
              await interaction.update({ content: `${player.name}, you’re dead! Wait ${waitRemaining} minutes to respawn.`, components: [mainMenu, secondRow] });
              return;
            }
          }
          if (player.energy < 1) {
            await interaction.update({ content: `${player.name}, out of energy! Regen 1/hour. Energy: ${player.energy}/5`, components: [mainMenu, secondRow] });
            return;
          }
          player.energy -= 1;
          const setting = weightedRandom(settings);
          collector.stop('scavenge');
          await handleRaid(player, interaction, menuMessage, setting, 1);
          return;
        } else if (interaction.customId === 'bunker') {
          const bunkerMenu = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder().setCustomId('deposit').setLabel('Deposit Loot').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('craft').setLabel('Craft').setStyle(ButtonStyle.Primary),
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
          const healingItems = `Scav Juice: ${inv.scavJuice || 0}\nRad Pills: ${inv.radPill || 0}`;
          const invMenu = new ActionRowBuilder()
            .addComponents(
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
            components: [mainMenu, secondRow]
          });
        } else if (interaction.customId === 'exit') {
          await interaction.update({ content: `${player.name}, session ended. Type !menu to return.`, components: [] });
          collector.stop('exit');
        }
        saveState();
      } catch (error) {
        console.error(`Menu error for ${player.name}:`, error.stack);
        await interaction.update({ content: `${player.name}, error occurred! Try again.`, components: [mainMenu, secondRow] }).catch(err => console.error('Failed to update on error:', err));
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

  if (command === 'save') {
    console.log('Current gameState:', JSON.stringify(gameState, null, 2));
    await message.reply('Game state logged to console—check Render logs!');
    saveState();
  }

  if (command === 'backup') {
    if (message.author.id !== 'YOUR_ADMIN_ID') return message.reply('Admin only command.');
    const stateJson = JSON.stringify(gameState, null, 2);
    await message.reply({
      content: 'Game state backup:',
      files: [{ attachment: Buffer.from(stateJson), name: 'gameState.json' }]
    });
  }
});

async function handleRaid(player, initialInteraction, menuMessage, setting, encounterCount) {
  console.log(`Starting scavenge for ${player.name} in ${setting.name}, encounter ${encounterCount}`);
  let loot = { scr: 0, scrapMetal: 0, radWaste: 0 }; // Track loot for this encounter
  let enemy = getRandomEnemy(setting.tiers);
  let enemyHp = enemy.hp;
  const filter = i => i.user.id === initialInteraction.user.id;

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

  const postBattleMenu = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('scavenge_loot').setLabel('Scavenge for Loot').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('go_further').setLabel('Go Further').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('return_main').setLabel('Return to Main Menu').setStyle(ButtonStyle.Secondary)
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
          const damageReduction = player.armor * 0.1; // 10% reduction per armor point
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
          components: [mainMenu(), secondRow()]
        });
        collector.stop('run');
        return;
      } else if (raidInteraction.customId === 'scavenge_loot') {
        const additionalScr = (Math.random() * 0.05).toFixed(2);
        const scrapChance = Math.random() < 0.5 ? Math.floor(Math.random() * 2) + 1 : 0; // 50% chance for 1-2 Scrap Metal
        const radWasteChance = Math.random() < 0.5 ? Math.floor(Math.random() * 2) + 1 : 0; // 50% chance for 1-2 Rad Waste
        loot.scr += parseFloat(additionalScr);
        loot.scrapMetal += scrapChance;
        loot.radWaste += radWasteChance;
        player.active.scr += loot.scr;
        player.active.scrapMetal = (player.active.scrapMetal || 0) + loot.scrapMetal;
        player.active.radWaste = (player.active.radWaste || 0) + loot.radWaste;
        await raidInteraction.update({
          content: `${player.name} scavenges the area...\nFound ${additionalScr} SCR, ${scrapChance} Scrap Metal, ${radWasteChance} Rad Waste.\nTotal Loot: ${player.active.scr.toFixed(2)} SCR, ${player.active.scrapMetal} Scrap Metal, ${player.active.radWaste} Rad Waste\nWhat next?`,
          embeds: [{ image: { url: setting.image } }],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('go_further').setLabel('Go Further').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('return_main').setLabel('Return to Main Menu').setStyle(ButtonStyle.Secondary)
            )
          ]
        });
        return;
      } else if (raidInteraction.customId === 'go_further') {
        const isDeathsHollow = setting.name === 'Death’s Hollow';
        const encounterLimit = isDeathsHollow ? 2 : 1; // Allow up to 2 extra encounters in Death’s Hollow
        if (encounterCount >= encounterLimit + 1) {
          await raidInteraction.update({
            content: `${player.name}, you've ventured far enough in ${setting.name}. Time to head back!`,
            embeds: [{ image: { url: setting.image } }],
            components: [mainMenu(), secondRow()]
          });
          collector.stop('end');
          return;
        }
        const chance = Math.random();
        if (chance < 0.7) { // 70% chance of another enemy
          encounterCount++;
          await handleRaid(player, raidInteraction, menuMessage, setting, encounterCount);
          return;
        } else { // 30% chance of a hazard
          const hazardDamage = 5;
          player.hp = Math.max(0, player.hp - hazardDamage);
          if (player.hp <= 0) {
            player.active = { scr: 0, scrapMetal: 0, radWaste: 0 };
            player.lastRaid = Date.now();
            await raidInteraction.update({
              content: `${player.name}, a Rad Storm hits, dealing ${hazardDamage} damage! You collapse...\nAll active loot lost.`,
              embeds: [{ image: { url: setting.image } }],
              components: [mainMenu(), secondRow()]
            });
            collector.stop('death');
            return;
          }
          await raidInteraction.update({
            content: `${player.name}, a Rad Storm hits, dealing ${hazardDamage} damage! HP: ${player.hp}\nWhat next?`,
            embeds: [{ image: { url: setting.image } }],
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('go_further').setLabel('Go Further').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('return_main').setLabel('Return to Main Menu').setStyle(ButtonStyle.Secondary)
              )
            ]
          });
          return;
        }
      } else if (raidInteraction.customId === 'return_main') {
        await raidInteraction.update({
          content: `${player.name}, you head back from ${setting.name}.\nTotal Loot: ${player.active.scr.toFixed(2)} SCR, ${player.active.scrapMetal} Scrap Metal, ${player.active.radWaste} Rad Waste`,
          embeds: [{ image: { url: setting.image } }],
          components: [mainMenu(), secondRow()]
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
          components: [mainMenu(), secondRow()]
        });
        collector.stop('death');
        return;
      }

      const newContent = enemyHp > 0 
        ? `${player.name} - ${setting.name}\n${raidUpdate}Fight: ${enemy.name} (HP: ${enemyHp}) lunges!\nHP: ${player.hp}, Energy: ${player.energy}/5\nPick an action:`
        : `${player.name} - ${setting.name}\n${raidUpdate}What next?`;
      const newComponents = enemyHp > 0 
        ? [raidMenu()]
        : [postBattleMenu()];

      await raidInteraction.update({
        content: newContent,
        embeds: [{ image: { url: setting.image } }],
        components: newComponents
      });
      saveState();
    } catch (error) {
      console.error(`Scavenge error for ${player.name}:`, error.stack);
      await raidInteraction.update({
        content: `${player.name} - ${setting.name}\nError during scavenge! Returning to main menu.`,
        embeds: [{ image: { url: setting.image } }],
        components: [mainMenu(), secondRow()]
      }).catch(err => console.error('Failed to update on scavenge error:', err));
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
        components: [mainMenu(), secondRow()]
      }).catch(err => console.error('Failed to edit on scavenge end:', err));
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
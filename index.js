const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions] 
});

const TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const ADMIN_ADDRESS = '0xdbfb5034a49be4deba3f01f1e8455148d4657f0bc4344ac5ad39c0c121f53671';
const ADMIN_ID = 'YOUR_ADMIN_ID'; // Replace with your Discord ID

const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));

const STATE_FILE_PATH = path.join('/opt/render/project/src/gameState', 'gameState.json');

let gameState = { 
  players: {}, 
  leaderboards: { 
    furthestFloor: [], 
    mostRounds: [] 
  } 
};
if (fs.existsSync(STATE_FILE_PATH)) {
  gameState = JSON.parse(fs.readFileSync(STATE_FILE_PATH));
  console.log(`Loaded gameState from ${STATE_FILE_PATH}`);
} else {
  console.log(`No gameState file found at ${STATE_FILE_PATH}. Starting with empty state.`);
}

const enemies = {
  tier1: [
    { name: 'Slagwraith', hpMin: 20, hpMax: 30, attackMin: 5, attackMax: 10, scrMin: 0.1, scrMax: 0.3, flavor: 'A molten specter drips liquid metal as it drifts toward you.' },
    { name: 'Ashskitter', hpMin: 20, hpMax: 25, attackMin: 4, attackMax: 8, scrMin: 0.1, scrMax: 0.2, flavor: 'A chittering creature scuttles from the ash, claws gleaming.' },
    { name: 'Rustclinger', hpMin: 25, hpMax: 30, attackMin: 6, attackMax: 10, scrMin: 0.2, scrMax: 0.4, flavor: 'It clings to rusted beams, hissing through jagged teeth.' },
    { name: 'Dustshade', hpMin: 20, hpMax: 30, attackMin: 5, attackMax: 9, scrMin: 0.1, scrMax: 0.3, flavor: 'A shadowy form flickers in the dust, eyes glowing faintly.' },
    { name: 'Scrapsnapper', hpMin: 25, hpMax: 35, attackMin: 5, attackMax: 8, scrMin: 0.2, scrMax: 0.4, flavor: 'Its metal jaws snap hungrily as it lurches forward.' }
  ],
  tier2: [
    { name: 'Forgeborn Brute', hpMin: 40, hpMax: 60, attackMin: 10, attackMax: 15, scrMin: 0.5, scrMax: 0.8, flavor: 'A hulking construct of gears and fury stomps toward you.' },
    { name: 'Ashreaver', hpMin: 45, hpMax: 55, attackMin: 9, attackMax: 14, scrMin: 0.4, scrMax: 0.7, flavor: 'It wields a jagged blade, caked in ash and blood.' },
    { name: 'Slagstalker', hpMin: 40, hpMax: 50, attackMin: 8, attackMax: 13, scrMin: 0.5, scrMax: 0.8, flavor: 'A molten predator prowls, its eyes like burning coals.' },
    { name: 'Ironshrieker', hpMin: 50, hpMax: 60, attackMin: 11, attackMax: 16, scrMin: 0.6, scrMax: 0.9, flavor: 'Its scream echoes through twisted metal corridors.' },
    { name: 'Dustfang Marauder', hpMin: 45, hpMax: 55, attackMin: 10, attackMax: 14, scrMin: 0.5, scrMax: 0.7, flavor: 'A scarred beast charges, teeth bared and dripping.' }
  ],
  tier3: [
    { name: 'Ashen Overlord', hpMin: 80, hpMax: 100, attackMin: 15, attackMax: 20, scrMin: 1.0, scrMax: 2.0, flavor: 'A towering tyrant looms, wreathed in choking dust.', legendaryDrop: 'Ashen Crest' },
    { name: 'Slagborne Titan', hpMin: 90, hpMax: 110, attackMin: 16, attackMax: 22, scrMin: 1.2, scrMax: 2.5, flavor: 'Molten veins pulse across its massive frame.', legendaryDrop: 'Slagborne Core' },
    { name: 'Wraithforge Sentinel', hpMin: 85, hpMax: 105, attackMin: 14, attackMax: 20, scrMin: 1.1, scrMax: 2.2, flavor: 'A guardian of shadow and steel awakens.', legendaryDrop: 'Wraithforge Ember' },
    { name: 'Ashcrown Devourer', hpMin: 95, hpMax: 115, attackMin: 17, attackMax: 23, scrMin: 1.3, scrMax: 2.6, flavor: 'Its maw glows with the embers of devoured foes.', legendaryDrop: 'Ashcrown Shard' },
    { name: 'Ironveil Monarch', hpMin: 100, hpMax: 120, attackMin: 18, attackMax: 25, scrMin: 1.5, scrMax: 3.0, flavor: 'A regal horror clad in rusted splendor rises.', legendaryDrop: 'Ironveil Crown' }
  ]
};

const dungeons = [
  { name: 'Slagspire Hollow', desc: 'A jagged spire of molten metal and bone whispers with trapped voices.', tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Slagspire+Hollow' },
  { name: 'Ashveil Crucible', desc: 'A sunken forge shimmers with heat and malice.', tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Ashveil+Crucible' },
  { name: 'Wraithgorge', desc: 'A canyon of twisting shadows hides forgotten machines.', tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Wraithgorge' },
  { name: 'Dustspire Vault', desc: 'A crumbling tower hums with eerie silence.', tiers: [1, 2, 3], image: 'https://via.placeholder.com/150?text=Dustspire+Vault' },
  { name: 'Ironshroud Depths', desc: 'A labyrinth of rusted pipes groans under pressure.', tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Ironshroud+Depths' },
  { name: 'Slagfen Mire', desc: 'A swamp of molten tar bubbles with menace.', tiers: [2, 3], image: 'https://via.placeholder.com/150?text=Slagfen+Mire' },
  { name: 'Ashcleft Ruins', desc: 'Broken pillars stand amid swirling ash winds.', tiers: [1, 2], image: 'https://via.placeholder.com/150?text=Ashcleft+Ruins' },
  { name: 'Forgeveil Abyss', desc: 'A chasm glows with the heat of buried forges.', tiers: [2, 3], image: 'https://via.placeholder.com/150?text=Forgeveil+Abyss' }
];

const craftableItems = {
  weapons: [
    { name: 'Slagfang Cleaver', attackBonus: 5, slagShards: 5, rustScraps: 2, scrFee: 1, rarity: 'Common' },
    { name: 'Rustspike Dagger', attackBonus: 5, rustScraps: 4, ashDust: 3, scrFee: 1, rarity: 'Common' },
    { name: 'Ashbitter Axe', attackBonus: 5, ashDust: 5, slagShards: 2, scrFee: 1, rarity: 'Common' },
    { name: 'Forgeborn Edge', attackBonus: 10, slagShards: 8, forgeIngots: 4, dustCores: 1, scrFee: 1, rarity: 'Uncommon' },
    { name: 'Dustreaver Scythe', attackBonus: 10, ashDust: 7, dustCores: 3, wraithThreads: 2, scrFee: 1, rarity: 'Uncommon' },
    { name: 'Ironclad Hammer', attackBonus: 10, rustScraps: 9, forgeIngots: 5, wraithThreads: 1, scrFee: 1, rarity: 'Uncommon' },
    { name: 'Slaghowl Lance', attackBonus: 15, slagShards: 10, forgeIngots: 6, slagCrystals: 3, scrFee: 1, rarity: 'Epic' },
    { name: 'Ashveil Flail', attackBonus: 15, ashDust: 12, dustCores: 5, ashenRelics: 2, scrFee: 1, rarity: 'Epic' },
    { name: 'Wraithspike Trident', attackBonus: 15, rustScraps: 11, wraithThreads: 7, ironVeins: 2, scrFee: 1, rarity: 'Epic' },
    { name: 'Slagborne Reaver', attackBonus: 20, slagShards: 15, forgeIngots: 10, slagCrystals: 5, titanEssence: 1, legendaryItem: 'Slagborne Core', scrFee: 2, rarity: 'Legendary', bonus: { type: 'maxHp', value: 10, desc: '+10 Max HP' } },
    { name: 'Ashen Sovereign Blade', attackBonus: 20, ashDust: 15, dustCores: 10, ashenRelics: 5, titanEssence: 1, legendaryItem: 'Ashen Crest', scrFee: 2, rarity: 'Legendary', bonus: { type: 'energyCooldown', value: 0.05, desc: '-5% Energy Cooldown' } },
    { name: 'Wraithforge Glaive', attackBonus: 20, rustScraps: 15, wraithThreads: 10, ironVeins: 5, titanEssence: 1, legendaryItem: 'Wraithforge Ember', scrFee: 2, rarity: 'Legendary', bonus: { type: 'critChance', value: 0.1, desc: '+10% Crit Chance' } }
  ],
  armor: [
    { name: 'Ashwoven Shroud', armorBonus: 1, ashDust: 4, rustScraps: 3, scrFee: 1, rarity: 'Common' },
    { name: 'Rustpatch Vest', armorBonus: 1, rustScraps: 5, slagShards: 2, scrFee: 1, rarity: 'Common' },
    { name: 'Slaghide Cloak', armorBonus: 1, slagShards: 4, ashDust: 3, scrFee: 1, rarity: 'Common' },
    { name: 'Ironveil Plate', armorBonus: 2, rustScraps: 8, forgeIngots: 4, dustCores: 1, scrFee: 1, rarity: 'Uncommon' },
    { name: 'Dustforged Carapace', armorBonus: 2, ashDust: 9, dustCores: 3, wraithThreads: 2, scrFee: 1, rarity: 'Uncommon' },
    { name: 'Forgeweave Mantle', armorBonus: 2, slagShards: 7, forgeIngots: 5, wraithThreads: 1, scrFee: 1, rarity: 'Uncommon' },
    { name: 'Slagthorn Guard', armorBonus: 3, slagShards: 11, forgeIngots: 6, slagCrystals: 2, scrFee: 1, rarity: 'Epic' },
    { name: 'Ashspire Shell', armorBonus: 3, ashDust: 10, dustCores: 5, ashenRelics: 3, scrFee: 1, rarity: 'Epic' },
    { name: 'Wraithsteel Harness', armorBonus: 3, rustScraps: 12, wraithThreads: 7, ironVeins: 2, scrFee: 1, rarity: 'Epic' },
    { name: 'Ashcrown Mantle', armorBonus: 5, ashDust: 15, dustCores: 10, ashenRelics: 5, titanEssence: 1, legendaryItem: 'Ashcrown Shard', scrFee: 2, rarity: 'Legendary', bonus: { type: 'hpRegen', value: 2, desc: '+2 HP Regen per tick' } },
    { name: 'Ironveil Regalia', armorBonus: 5, rustScraps: 15, wraithThreads: 10, ironVeins: 5, titanEssence: 1, legendaryItem: 'Ironveil Crown', scrFee: 2, rarity: 'Legendary', bonus: { type: 'damageResist', value: 0.1, desc: '+10% Damage Resistance' } },
    { name: 'Slagforged Aegis', armorBonus: 5, slagShards: 15, forgeIngots: 10, slagCrystals: 5, titanEssence: 1, legendaryItem: 'Slagborne Core', scrFee: 2, rarity: 'Legendary', bonus: { type: 'energyEfficiency', value: 0.5, desc: '-50% Sparkcore Cost' } }
  ]
};

function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    if (random < (item.weight || 1)) return item;
    random -= (item.weight || 1);
  }
  return items[items.length - 1];
}

function rollD20(modifier = 0, critBonus = 0) {
  const roll = Math.floor(Math.random() * 20) + 1;
  const crit = roll === 20 ? 2 : roll === 1 ? 0 : 1;
  return crit === 0 ? 0 : Math.floor((roll + modifier) * crit * (1 + critBonus));
}

function getScaledEnemy(tiers, floor) {
  const tier = Math.min(3, Math.floor(floor / 5) + 1);
  const baseEnemy = enemies[`tier${tier}`][Math.floor(Math.random() * enemies[`tier${tier}`].length)];
  return {
    ...baseEnemy,
    hp: Math.floor(baseEnemy.hpMin * (1 + 0.1 * floor)),
    attackMin: Math.floor(baseEnemy.attackMin * (1 + 0.1 * floor)),
    attackMax: Math.floor(baseEnemy.attackMax * (1 + 0.1 * floor)),
    scrMax: baseEnemy.scrMax * (1 + 0.05 * floor)
  };
}

function rollForMaterials(floor, enemyName) {
  const loot = { slagShards: 0, rustScraps: 0, ashDust: 0, forgeIngots: 0, dustCores: 0, wraithThreads: 0, slagCrystals: 0, ashenRelics: 0, ironVeins: 0, titanEssence: 0, legendaryItem: null };
  if (Math.random() < 0.5) loot.slagShards += Math.floor(floor / 2) + 1;
  if (Math.random() < 0.4) loot.rustScraps += Math.floor(floor / 3) + 1;
  if (Math.random() < 0.3) loot.ashDust += Math.floor(floor / 4) + 1;
  if (Math.random() < 0.2) loot.forgeIngots += 1;
  if (Math.random() < 0.15) loot.dustCores += 1;
  if (Math.random() < 0.1) loot.wraithThreads += 1;
  if (Math.random() < 0.05) loot.slagCrystals += 1;
  if (Math.random() < 0.04) loot.ashenRelics += 1;
  if (Math.random() < 0.03) loot.ironVeins += 1;
  if (Math.random() < 0.01) {
    loot.titanEssence += 1;
    const tier3Enemy = enemies.tier3.find(e => e.name === enemyName);
    if (tier3Enemy && Math.random() < 0.1) loot.legendaryItem = tier3Enemy.legendaryDrop;
  }
  return loot;
}

function rollForMaterialPack(packType) {
  const loot = { slagShards: 0, rustScraps: 0, ashDust: 0, forgeIngots: 0, dustCores: 0, wraithThreads: 0, slagCrystals: 0, ashenRelics: 0, ironVeins: 0, titanEssence: 0, legendaryItem: null };
  const mats = [];
  if (packType === 'common') {
    if (Math.random() < 0.7) mats.push('slagShards');
    if (Math.random() < 0.6) mats.push('rustScraps');
    if (Math.random() < 0.5) mats.push('ashDust');
  } else if (packType === 'uncommon') {
    if (Math.random() < 0.6) mats.push('forgeIngots');
    if (Math.random() < 0.5) mats.push('dustCores');
    if (Math.random() < 0.4) mats.push('wraithThreads');
  } else if (packType === 'epic') {
    if (Math.random() < 0.5) mats.push('slagCrystals');
    if (Math.random() < 0.4) mats.push('ashenRelics');
    if (Math.random() < 0.3) mats.push('ironVeins');
  } else if (packType === 'legendary') {
    if (Math.random() < 0.4) mats.push('titanEssence');
    if (Math.random() < 0.1) loot.legendaryItem = weightedRandom(['Ashen Crest', 'Slagborne Core', 'Wraithforge Ember', 'Ashcrown Shard', 'Ironveil Crown']);
    if (Math.random() < 0.3) mats.push('slagCrystals');
  }
  mats.slice(0, 3).forEach(mat => loot[mat] += 1); // Limit to 3 mats
  return loot;
}

async function mintNFT(player, itemName, rarity) {
  const tx = new Transaction();
  tx.moveCall({
    target: "0x2::nft::mint",
    arguments: [tx.pure(player.suiAddress), tx.pure(itemName), tx.pure(rarity)]
  });
  const suiCoins = await suiClient.getCoins({ owner: ADMIN_ADDRESS });
  if (!suiCoins.data.length) throw new Error('No SUI for gas');
  tx.setGasBudget(20000000);
  tx.setGasPayment([{ objectId: suiCoins.data[0].coinObjectId, version: suiCoins.data[0].version, digest: suiCoins.data[0].digest }]);
  const result = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
  return result.digest;
}

function useResource(player, resource, amount) {
  const efficiency = player.equipped.armor?.bonus?.type === 'energyEfficiency' ? player.equipped.armor.bonus.value : 0;
  const adjustedAmount = Math.max(0, amount * (1 - efficiency));
  if (player.active[resource] >= adjustedAmount) {
    player.active[resource] -= adjustedAmount;
    return true;
  }
  return false;
}

function updateLeaderboard(type, playerId, value) {
  const leaderboard = gameState.leaderboards[type];
  const entry = leaderboard.find(e => e.id === playerId);
  if (entry) {
    if (value > entry.value) entry.value = value;
  } else {
    leaderboard.push({ id: playerId, name: gameState.players[playerId].name, value });
  }
  gameState.leaderboards[type].sort((a, b) => b.value - a.value);
  if (leaderboard.length > 10) leaderboard.length = 10; // Top 10 only
}

function saveState() {
  try {
    const stateDir = path.dirname(STATE_FILE_PATH);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(gameState, null, 2));
    console.log(`Game state saved to ${STATE_FILE_PATH}`);
  } catch (error) {
    console.error('Failed to save game state:', error);
  }
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
          player.hp = 10;
          player.lastRegen = now;
        }
      } else {
        const now = Date.now();
        if (!player.lastRegen) player.lastRegen = now;
        const regenBonus = player.equipped.armor?.bonus?.type === 'hpRegen' ? player.equipped.armor.bonus.value : 0;
        if (now - player.lastRegen >= 6 * 60 * 1000) {
          const maxHpBonus = player.equipped.weapon?.bonus?.type === 'maxHp' ? player.equipped.weapon.bonus.value : 0;
          player.hp = Math.min(50 + maxHpBonus, player.hp + 5 + regenBonus);
          player.lastRegen = now;
        }
        const cooldownReduction = player.equipped.weapon?.bonus?.type === 'energyCooldown' ? player.equipped.weapon.bonus.value : 0;
        if (now - (player.lastEnergyRegen || 0) >= 60 * 60 * 1000 * (1 - cooldownReduction)) {
          player.energy = Math.min(5, player.energy + 1);
          player.lastEnergyRegen = now;
        }
      }
    }
    saveState();
  }, 60 * 1000);

  setInterval(() => {
    console.log(`Bot still running at ${new Date().toISOString()}`);
  }, 60 * 60 * 1000);
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
    try {
      console.log(`Registering ${message.author.id} with address ${suiAddress}`);
      gameState.players[message.author.id] = {
        suiAddress,
        name: args[1] || `Raider_${message.author.id.slice(-4)}`,
        hp: 50,
        attack: 10,
        armor: 0,
        energy: 5,
        equipped: { weapon: null, armor: null },
        active: { scr: 0, sparkcores: 0, slagShards: 0, rustScraps: 0, ashDust: 0, forgeIngots: 0, dustCores: 0, wraithThreads: 0, slagCrystals: 0, ashenRelics: 0, ironVeins: 0, titanEssence: 0 },
        bunker: { scr: 0, sparkcores: 0, slagShards: 0, rustScraps: 0, ashDust: 0, forgeIngots: 0, dustCores: 0, wraithThreads: 0, slagCrystals: 0, ashenRelics: 0, ironVeins: 0, titanEssence: 0 },
        lastRaid: 0,
        lastRegen: Date.now(),
        lastEnergyRegen: Date.now(),
        inventory: { scavJuice: 0, reviveStim: 0, weapons: [], armor: [], misc: [] },
        furthestFloor: 0,
        roundsSurvived: 0
      };
      player = gameState.players[message.author.id];
      await message.reply(`Registered as ${player.name}! Use !menu to start playing.`);
      saveState();
    } catch (error) {
      await message.reply(`Registration failed: ${error.message}`);
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
        new ButtonBuilder().setCustomId('scavenge').setLabel('Scavenge').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('bunker').setLabel('Bunker').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('store').setLabel('Store').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('stats').setLabel('Stats').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('crafting').setLabel('Crafting').setStyle(ButtonStyle.Primary)
      );
    const secondRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('inventory').setLabel('Inventory').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('leaderboards').setLabel('Leaderboards').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('exit').setLabel('Exit').setStyle(ButtonStyle.Secondary)
      );

    const menuMessage = await message.reply({
      content: `**Wasteland Terminal - ${player.name}**\nChoose your action:`,
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
    gameState = { players: {}, leaderboards: { furthestFloor: [], mostRounds: [] } };
    saveState();
    await message.reply('Game state has been reset to empty.');
  }
});

async function handleMenuInteraction(player, menuMessage, userId) {
  const filter = i => i.user.id === userId;
  const collector = menuMessage.createMessageComponentCollector({ filter, time: 300000 });

  const mainMenu = () => [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('scavenge').setLabel('Scavenge').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('bunker').setLabel('Bunker').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('store').setLabel('Store').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stats').setLabel('Stats').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('crafting').setLabel('Crafting').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('inventory').setLabel('Inventory').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('leaderboards').setLabel('Leaderboards').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('exit').setLabel('Exit').setStyle(ButtonStyle.Secondary)
    )
  ];

  collector.on('collect', async (interaction) => {
    try {
      console.log(`Button clicked by ${player.name}: ${interaction.customId}`);

      if (interaction.customId === 'scavenge') {
        const now = Date.now();
        if (player.hp <= 0) {
          const timeSinceDeath = now - player.lastRaid;
          if (timeSinceDeath < 24 * 60 * 60 * 1000) {
            const waitRemaining = Math.ceil((24 * 60 * 60 * 1000 - timeSinceDeath) / (60 * 60 * 1000));
            await interaction.update({ content: `${player.name}, you’re dead! Wait ${waitRemaining} hours to respawn or use a Revive Stim.`, components: mainMenu() });
            return;
          }
        }
        if (player.energy < 1) {
          await interaction.update({ content: `${player.name}, out of energy! Regen 1/hour or buy with SUI. Energy: ${player.energy}/5`, components: mainMenu() });
          return;
        }
        player.energy -= 1;
        const dungeon = weightedRandom(dungeons);
        collector.stop('scavenge');
        await handleEndlessDungeon(player, interaction, menuMessage, dungeon, 1, userId);
        return;
      } else if (interaction.customId === 'bunker') {
        const bunkerMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('deposit').setLabel('Deposit Loot').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('sui_wallet').setLabel('Sui Wallet').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
        const activeMats = Object.entries(player.active).map(([key, value]) => `${key}: ${value}`).join(', ');
        const bunkerMats = Object.entries(player.bunker).map(([key, value]) => `${key}: ${value}`).join(', ');
        await interaction.update({
          content: `**${player.name}'s Bunker**\n**Active Loot**: ${activeMats}\n**Stored Loot**: ${bunkerMats}`,
          components: [bunkerMenu]
        });
      } else if (interaction.customId === 'deposit') {
        Object.keys(player.active).forEach(key => {
          player.bunker[key] = (player.bunker[key] || 0) + player.active[key];
          player.active[key] = 0;
        });
        const bunkerMats = Object.entries(player.bunker).map(([key, value]) => `${key}: ${value}`).join(', ');
        await interaction.update({
          content: `**${player.name}'s Bunker**\nLoot deposited!\n**Stored Loot**: ${bunkerMats}`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success))]
        });
      } else if (interaction.customId === 'sui_wallet') {
        try {
          const suiBalance = await suiClient.getBalance({ owner: player.suiAddress });
          await interaction.update({
            content: `**${player.name}'s Sui Wallet**\nSUI Balance: ${(suiBalance.totalBalance / 1e9).toFixed(2)} SUI`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success))]
          });
        } catch (error) {
          console.error('Error fetching wallet balance:', error);
          await interaction.update({
            content: `**${player.name}'s Sui Wallet**\nError fetching balance: ${error.message}`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bunker').setLabel('Back to Bunker').setStyle(ButtonStyle.Success))]
          });
        }
      } else if (interaction.customId === 'crafting') {
        const craftMenu1 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('craft_slagfang_cleaver').setLabel('Slagfang Cleaver').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_rustspike_dagger').setLabel('Rustspike Dagger').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_ashbitter_axe').setLabel('Ashbitter Axe').setStyle(ButtonStyle.Primary)
          );
        const craftMenu2 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('craft_ashwoven_shroud').setLabel('Ashwoven Shroud').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_rustpatch_vest').setLabel('Rustpatch Vest').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_slaghide_cloak').setLabel('Slaghide Cloak').setStyle(ButtonStyle.Primary)
          );
        const craftMenu3 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('craft_forgeborn_edge').setLabel('Forgeborn Edge').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_dustreaver_scythe').setLabel('Dustreaver Scythe').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_ironclad_hammer').setLabel('Ironclad Hammer').setStyle(ButtonStyle.Primary)
          );
        const craftMenu4 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('craft_ironveil_plate').setLabel('Ironveil Plate').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_dustforged_carapace').setLabel('Dustforged Carapace').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_forgeweave_mantle').setLabel('Forgeweave Mantle').setStyle(ButtonStyle.Primary)
          );
        const craftMenu5 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('craft_slaghowl_lance').setLabel('Slaghowl Lance').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_ashveil_flail').setLabel('Ashveil Flail').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('craft_wraithspike_trident').setLabel('Wraithspike Trident').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
        const craftText = `**Crafting Station - ${player.name}**\n**Stored Materials**: ${Object.entries(player.bunker).map(([k, v]) => `${k}: ${v}`).join(', ')}\n\nSelect an item to craft:`;
        await interaction.update({
          content: craftText,
          components: [craftMenu1, craftMenu2, craftMenu3, craftMenu4, craftMenu5]
        });
      } else if (interaction.customId.startsWith('craft_')) {
        const itemName = interaction.customId.replace('craft_', '').replace(/_/g, ' ');
        const weapon = craftableItems.weapons.find(i => i.name.toLowerCase() === itemName);
        const armor = craftableItems.armor.find(i => i.name.toLowerCase() === itemName);
        const item = weapon || armor;
        if (!item) {
          await interaction.update({ content: `${player.name}, invalid item!`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('crafting').setLabel('Back to Crafting').setStyle(ButtonStyle.Primary))] });
          return;
        }
        const hasMats = (!item.slagShards || player.bunker.slagShards >= item.slagShards) &&
                        (!item.rustScraps || player.bunker.rustScraps >= item.rustScraps) &&
                        (!item.ashDust || player.bunker.ashDust >= item.ashDust) &&
                        (!item.forgeIngots || player.bunker.forgeIngots >= item.forgeIngots) &&
                        (!item.dustCores || player.bunker.dustCores >= item.dustCores) &&
                        (!item.wraithThreads || player.bunker.wraithThreads >= item.wraithThreads) &&
                        (!item.slagCrystals || player.bunker.slagCrystals >= item.slagCrystals) &&
                        (!item.ashenRelics || player.bunker.ashenRelics >= item.ashenRelics) &&
                        (!item.ironVeins || player.bunker.ironVeins >= item.ironVeins) &&
                        (!item.titanEssence || player.bunker.titanEssence >= item.titanEssence) &&
                        player.bunker.scr >= item.scrFee;
        const hasLegendaryItem = !item.legendaryItem || player.inventory.misc.some(m => m.name === item.legendaryItem);
        if (hasMats && hasLegendaryItem) {
          if (item.slagShards) player.bunker.slagShards -= item.slagShards;
          if (item.rustScraps) player.bunker.rustScraps -= item.rustScraps;
          if (item.ashDust) player.bunker.ashDust -= item.ashDust;
          if (item.forgeIngots) player.bunker.forgeIngots -= item.forgeIngots;
          if (item.dustCores) player.bunker.dustCores -= item.dustCores;
          if (item.wraithThreads) player.bunker.wraithThreads -= item.wraithThreads;
          if (item.slagCrystals) player.bunker.slagCrystals -= item.slagCrystals;
          if (item.ashenRelics) player.bunker.ashenRelics -= item.ashenRelics;
          if (item.ironVeins) player.bunker.ironVeins -= item.ironVeins;
          if (item.titanEssence) player.bunker.titanEssence -= item.titanEssence;
          player.bunker.scr -= item.scrFee;
          if (item.legendaryItem) {
            const index = player.inventory.misc.findIndex(m => m.name === item.legendaryItem);
            player.inventory.misc.splice(index, 1);
          }
          const nftDigest = item.rarity === 'Legendary' ? await mintNFT(player, item.name, item.rarity) : null;
          const itemData = { name: item.name, ...(item.attackBonus ? { attackBonus: item.attackBonus } : { armorBonus: item.armorBonus }), nftId: nftDigest, bonus: item.bonus };
          if (item.attackBonus) player.inventory.weapons.push(itemData);
          else player.inventory.armor.push(itemData);
          await interaction.update({
            content: `**Crafting Success - ${player.name}**\nCrafted: ${item.name}${item.bonus ? ` (${item.bonus.desc})` : ''}${nftDigest ? `\nMinted as NFT: ${nftDigest}` : ''}`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('crafting').setLabel('Back to Crafting').setStyle(ButtonStyle.Primary))]
          });
        } else {
          const neededMats = [
            item.slagShards ? `${item.slagShards} SS (${player.bunker.slagShards})` : '',
            item.rustScraps ? `${item.rustScraps} RS (${player.bunker.rustScraps})` : '',
            item.ashDust ? `${item.ashDust} AD (${player.bunker.ashDust})` : '',
            item.forgeIngots ? `${item.forgeIngots} FI (${player.bunker.forgeIngots})` : '',
            item.dustCores ? `${item.dustCores} DC (${player.bunker.dustCores})` : '',
            item.wraithThreads ? `${item.wraithThreads} WT (${player.bunker.wraithThreads})` : '',
            item.slagCrystals ? `${item.slagCrystals} SC (${player.bunker.slagCrystals})` : '',
            item.ashenRelics ? `${item.ashenRelics} AR (${player.bunker.ashenRelics})` : '',
            item.ironVeins ? `${item.ironVeins} IV (${player.bunker.ironVeins})` : '',
            item.titanEssence ? `${item.titanEssence} TE (${player.bunker.titanEssence})` : '',
            `${item.scrFee} SCR (${player.bunker.scr})`,
            item.legendaryItem ? item.legendaryItem : ''
          ].filter(Boolean).join(', ');
          await interaction.update({
            content: `**Crafting Failed - ${player.name}**\nNot enough materials for ${item.name}!\nNeeded: ${neededMats}`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('crafting').setLabel('Back to Crafting').setStyle(ButtonStyle.Primary))]
          });
        }
      } else if (interaction.customId === 'store') {
        const storeMenu = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('buy_energy').setLabel('Energy Refill (0.01 SUI)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_common_pack').setLabel('Common Materials (0.005 SUI)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_uncommon_pack').setLabel('Uncommon Materials (0.01 SUI)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_epic_pack').setLabel('Epic Materials (0.02 SUI)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_legendary_pack').setLabel('Legendary Materials (0.05 SUI)').setStyle(ButtonStyle.Primary)
          );
        const secondRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('buy_scav_juice').setLabel('Scav Juice (5 SCR)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_revive_stim').setLabel('Revive Stim (10 SCR)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `**Store - ${player.name}**\nBunker SCR: ${player.bunker.scr.toFixed(2)}\nChoose an item to purchase:`,
          components: [storeMenu, secondRow]
        });
      } else if (interaction.customId === 'buy_energy') {
        const suiCost = 0.01 * 1e9; // 0.01 SUI in MIST
        try {
          const suiCoins = await suiClient.getCoins({ owner: player.suiAddress });
          if (!suiCoins.data.length || suiCoins.data[0].balance < suiCost) throw new Error('Insufficient SUI');
          const tx = new Transaction();
          const [suiCoin] = tx.splitCoins(tx.object(suiCoins.data[0].coinObjectId), [suiCost]);
          tx.transferObjects([suiCoin], ADMIN_ADDRESS);
          tx.setGasBudget(20000000);
          const adminSuiCoins = await suiClient.getCoins({ owner: ADMIN_ADDRESS });
          if (!adminSuiCoins.data.length) throw new Error('Admin has no SUI for gas');
          tx.setGasPayment([{ objectId: adminSuiCoins.data[0].coinObjectId, version: adminSuiCoins.data[0].version, digest: adminSuiCoins.data[0].digest }]);
          const result = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
          player.energy = 5;
          await interaction.update({
            content: `**Purchase - ${player.name}**\nBought Energy Refill for 0.01 SUI!\nEnergy: ${player.energy}/5\nTx: ${result.digest}`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary))]
          });
        } catch (error) {
          await interaction.update({
            content: `**Purchase Failed - ${player.name}**\nFailed to buy Energy Refill: ${error.message}. Need 0.01 SUI.`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary))]
          });
        }
      } else if (interaction.customId.startsWith('buy_') && interaction.customId.includes('_pack')) {
        const packType = interaction.customId.split('_')[1];
        const suiCosts = { common: 0.005 * 1e9, uncommon: 0.01 * 1e9, epic: 0.02 * 1e9, legendary: 0.05 * 1e9 };
        const suiCost = suiCosts[packType];
        try {
          const suiCoins = await suiClient.getCoins({ owner: player.suiAddress });
          if (!suiCoins.data.length || suiCoins.data[0].balance < suiCost) throw new Error('Insufficient SUI');
          const tx = new Transaction();
          const [suiCoin] = tx.splitCoins(tx.object(suiCoins.data[0].coinObjectId), [suiCost]);
          tx.transferObjects([suiCoin], ADMIN_ADDRESS);
          tx.setGasBudget(20000000);
          const adminSuiCoins = await suiClient.getCoins({ owner: ADMIN_ADDRESS });
          if (!adminSuiCoins.data.length) throw new Error('Admin has no SUI for gas');
          tx.setGasPayment([{ objectId: adminSuiCoins.data[0].coinObjectId, version: adminSuiCoins.data[0].version, digest: adminSuiCoins.data[0].digest }]);
          const result = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
          const loot = rollForMaterialPack(packType);
          Object.keys(loot).forEach(key => player.active[key] = (player.active[key] || 0) + (loot[key] || 0));
          if (loot.legendaryItem) player.inventory.misc.push({ name: loot.legendaryItem });
          const lootText = Object.entries(loot).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
          await interaction.update({
            content: `**Purchase - ${player.name}**\nBought ${packType.charAt(0).toUpperCase() + packType.slice(1)} Materials for ${(suiCost / 1e9).toFixed(3)} SUI!\nLoot: ${lootText}\nTx: ${result.digest}`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary))]
          });
        } catch (error) {
          await interaction.update({
            content: `**Purchase Failed - ${player.name}**\nFailed to buy ${packType} materials: ${error.message}. Need ${(suiCost / 1e9).toFixed(3)} SUI.`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary))]
          });
        }
      } else if (interaction.customId === 'buy_scav_juice') {
        if (player.bunker.scr >= 5) {
          player.bunker.scr -= 5;
          player.inventory.scavJuice += 1;
          await interaction.update({
            content: `**Purchase - ${player.name}**\nBought Scav Juice for 5 SCR!\nInventory: ${player.inventory.scavJuice} Scav Juice`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary))]
          });
        } else {
          await interaction.update({
            content: `**Purchase Failed - ${player.name}**\nNot enough SCR! Need 5, have ${player.bunker.scr.toFixed(2)}.`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary))]
          });
        }
      } else if (interaction.customId === 'buy_revive_stim') {
        if (player.bunker.scr >= 10) {
          player.bunker.scr -= 10;
          player.inventory.reviveStim += 1;
          await interaction.update({
            content: `**Purchase - ${player.name}**\nBought Revive Stim for 10 SCR!\nInventory: ${player.inventory.reviveStim} Revive Stims`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary))]
          });
        } else {
          await interaction.update({
            content: `**Purchase Failed - ${player.name}**\nNot enough SCR! Need 10, have ${player.bunker.scr.toFixed(2)}.`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store').setLabel('Back to Store').setStyle(ButtonStyle.Primary))]
          });
        }
      } else if (interaction.customId === 'stats') {
        const maxHpBonus = player.equipped.weapon?.bonus?.type === 'maxHp' ? player.equipped.weapon.bonus.value : 0;
        const damageResist = player.equipped.armor?.bonus?.type === 'damageResist' ? player.equipped.armor.bonus.value : 0;
        await interaction.update({
          content: `**Stats - ${player.name}**\nHP: ${player.hp}/${50 + maxHpBonus}\nAttack: ${player.attack} (+${Math.floor(player.attack / 5)} to D20${player.equipped.weapon?.bonus?.type === 'critChance' ? `, ${player.equipped.weapon.bonus.desc}` : ''})\nArmor: ${player.armor} (${Math.floor(player.armor * 5 + damageResist * 100)}% damage reduction${player.equipped.armor?.bonus && player.equipped.armor.bonus.type !== 'damageResist' ? `, ${player.equipped.armor.bonus.desc}` : ''})\nEnergy: ${player.energy}/5`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary))]
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
          content: `**Inventory - ${player.name}**\nSelect a category:`,
          components: [invMenu]
        });
      } else if (interaction.customId === 'inv_armor') {
        const armorItems = player.inventory.armor.length ? player.inventory.armor.map((a, i) => `${i + 1}. ${a.name} (+${a.armorBonus} Armor${a.bonus ? `, ${a.bonus.desc}` : ''})${a.nftId ? ` [NFT: ${a.nftId}]` : ''}`).join('\n') : 'None';
        await interaction.update({
          content: `**Armor - ${player.name}**\n${armorItems}`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('equip').setLabel('Equip Item').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          )]
        });
      } else if (interaction.customId === 'inv_weapons') {
        const weapons = player.inventory.weapons.length ? player.inventory.weapons.map((w, i) => `${i + 1}. ${w.name} (+${w.attackBonus} Attack${w.bonus ? `, ${w.bonus.desc}` : ''})${w.nftId ? ` [NFT: ${w.nftId}]` : ''}`).join('\n') : 'None';
        await interaction.update({
          content: `**Weapons - ${player.name}**\n${weapons}`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('equip').setLabel('Equip Item').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          )]
        });
      } else if (interaction.customId === 'inv_healing') {
        const healingItems = `Scav Juice: ${player.inventory.scavJuice || 0}\nRevive Stims: ${player.inventory.reviveStim || 0}`;
        await interaction.update({
          content: `**Healing Items - ${player.name}**\n${healingItems}`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('use_revive_stim').setLabel('Use Revive Stim').setStyle(ButtonStyle.Success).setDisabled(!(player.hp <= 0 && player.inventory.reviveStim > 0)),
            new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary)
          )]
        });
      } else if (interaction.customId === 'inv_misc') {
        const miscItems = player.inventory.misc.length ? player.inventory.misc.map((m, i) => `${i + 1}. ${m.name}`).join('\n') : 'None';
        await interaction.update({
          content: `**Misc Items - ${player.name}**\n${miscItems}`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary))]
        });
      } else if (interaction.customId === 'use_revive_stim') {
        if (player.hp <= 0 && player.inventory.reviveStim > 0) {
          player.hp = 10;
          player.inventory.reviveStim -= 1;
          player.lastRegen = Date.now();
          await interaction.update({
            content: `**${player.name}**\nUsed a Revive Stim! HP restored to 10.\nRevive Stims: ${player.inventory.reviveStim}`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary))]
          });
        } else {
          await interaction.update({
            content: `**${player.name}**\nYou can only use a Revive Stim when dead and if you have one!`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary))]
          });
        }
      } else if (interaction.customId === 'equip') {
        const rows = [];
        let equipMenu = new ActionRowBuilder();
        let componentCount = 0;

        player.inventory.weapons.forEach((w, i) => {
          if (componentCount >= 5) {
            rows.push(equipMenu);
            equipMenu = new ActionRowBuilder();
            componentCount = 0;
          }
          equipMenu.addComponents(new ButtonBuilder().setCustomId(`equip_weapon_${i}`).setLabel(`Equip ${w.name}`).setStyle(ButtonStyle.Primary));
          componentCount++;
        });

        player.inventory.armor.forEach((a, i) => {
          if (componentCount >= 5) {
            rows.push(equipMenu);
            equipMenu = new ActionRowBuilder();
            componentCount = 0;
          }
          equipMenu.addComponents(new ButtonBuilder().setCustomId(`equip_armor_${i}`).setLabel(`Equip ${a.name}`).setStyle(ButtonStyle.Primary));
          componentCount++;
        });

        if (equipMenu.components.length > 0) {
          if (equipMenu.components.length < 5) equipMenu.addComponents(new ButtonBuilder().setCustomId('inventory').setLabel('Back').setStyle(ButtonStyle.Secondary));
          rows.push(equipMenu);
        } else {
          rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('inventory').setLabel('Back').setStyle(ButtonStyle.Secondary)));
        }

        await interaction.update({
          content: `**Equip Item - ${player.name}**\nSelect an item to equip:`,
          components: rows
        });
      } else if (interaction.customId.startsWith('equip_weapon_')) {
        const index = parseInt(interaction.customId.split('_')[2]);
        const weapon = player.inventory.weapons[index];
        player.equipped.weapon = weapon;
        player.attack = 10 + weapon.attackBonus;
        await interaction.update({
          content: `**${player.name}**\nEquipped ${weapon.name}${weapon.bonus ? ` (${weapon.bonus.desc})` : ''}!\nAttack: ${player.attack} (+${Math.floor(player.attack / 5)} to D20)`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary))]
        });
      } else if (interaction.customId.startsWith('equip_armor_')) {
        const index = parseInt(interaction.customId.split('_')[2]);
        const armor = player.inventory.armor[index];
        player.equipped.armor = armor;
        player.armor = armor.armorBonus;
        await interaction.update({
          content: `**${player.name}**\nEquipped ${armor.name}${armor.bonus ? ` (${armor.bonus.desc})` : ''}!\nArmor: ${player.armor} (${player.armor * 5}% damage reduction)`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('inventory').setLabel('Back to Inventory').setStyle(ButtonStyle.Secondary))]
        });
      } else if (interaction.customId === 'leaderboards') {
        const furthestFloorText = gameState.leaderboards.furthestFloor.length 
          ? gameState.leaderboards.furthestFloor.map((e, i) => `${i + 1}. ${e.name}: Floor ${e.value}`).join('\n') 
          : 'No records yet.';
        const mostRoundsText = gameState.leaderboards.mostRounds.length 
          ? gameState.leaderboards.mostRounds.map((e, i) => `${i + 1}. ${e.name}: ${e.value} Rounds`).join('\n') 
          : 'No records yet.';
        await interaction.update({
          content: `**Leaderboards - ${player.name}**\n**Furthest Floor Reached**\n${furthestFloorText}\n\n**Most Rounds Survived**\n${mostRoundsText}`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary))]
        });
      } else if (interaction.customId === 'back') {
        await interaction.update({
          content: `**Wasteland Terminal - ${player.name}**\nChoose your action:`,
          components: mainMenu()
        });
      } else if (interaction.customId === 'exit') {
        await interaction.update({ content: `**${player.name}**\nSession ended. Type !menu to return.`, components: [] });
        collector.stop('exit');
      }
      saveState();
    } catch (error) {
      console.error(`Menu error for ${player.name}:`, error.stack);
      await interaction.update({ content: `**${player.name}**\nInteraction failed! Use !menu to restart.`, components: [] }).catch(() => {});
      collector.stop('error');
    }
  });

  collector.on('end', (collected, reason) => {
    console.log(`Main collector ended for ${player.name}. Reason: ${reason}`);
    if (reason === 'time' || reason === 'exit') {
      menuMessage.edit({
        content: `**${player.name}**\nSession ended. Type !menu to return.`,
        components: []
      }).catch(err => console.error('Failed to edit on end:', err));
      saveState();
    }
  });
}

async function handleEndlessDungeon(player, initialInteraction, menuMessage, dungeon, floor = 1, userId) {
  console.log(`${player.name} begins endless run in ${dungeon.name}, floor ${floor}`);
  let loot = { scr: 0, sparkcores: 0, slagShards: 0, rustScraps: 0, ashDust: 0, forgeIngots: 0, dustCores: 0, wraithThreads: 0, slagCrystals: 0, ashenRelics: 0, ironVeins: 0, titanEssence: 0 };
  let enemy = getScaledEnemy(dungeon.tiers, floor);
  let enemyHp = enemy.hp;
  let hasExplored = false;
  let rounds = 0;
  const filter = i => i.user.id === userId;

  const combatMenu = () => new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('attack').setLabel('Attack').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('heal').setLabel('Use Scav Juice').setStyle(ButtonStyle.Success).setDisabled(player.inventory.scavJuice <= 0),
      new ButtonBuilder().setCustomId('explore').setLabel('Explore').setStyle(ButtonStyle.Secondary).setDisabled(hasExplored || enemyHp > 0),
      new ButtonBuilder().setCustomId('flee').setLabel('Flee').setStyle(ButtonStyle.Danger)
    );

  await initialInteraction.update({
    content: `**${dungeon.name} - Floor ${floor}**\n${player.name}, you enter: ${dungeon.desc}\n\n${enemy.flavor}\nEnemy: ${enemy.name} (${enemyHp}/${enemy.hp} HP)\nYou: ${player.hp} HP, ${player.energy}/5 Energy`,
    components: [combatMenu()]
  });

  const dungeonCollector = menuMessage.createMessageComponentCollector({ filter, time: 300000 });

  dungeonCollector.on('collect', async (interaction) => {
    try {
      if (interaction.customId === 'attack') {
        const critBonus = player.equipped.weapon?.bonus?.type === 'critChance' ? player.equipped.weapon.bonus.value : 0;
        const playerDamage = rollD20(Math.floor(player.attack / 5), critBonus);
        enemyHp -= playerDamage;
        let enemyDamage = 0;
        if (enemyHp > 0) {
          enemyDamage = Math.floor(Math.random() * (enemy.attackMax - enemy.attackMin + 1) + enemy.attackMin);
          const damageResist = player.equipped.armor?.bonus?.type === 'damageResist' ? player.equipped.armor.bonus.value : 0;
          enemyDamage = Math.max(0, Math.floor(enemyDamage * (1 - player.armor * 0.05 - damageResist)));
          player.hp -= enemyDamage;
        } else {
          rounds++;
        }
        if (player.hp <= 0) {
          player.lastRaid = Date.now();
          updateLeaderboard('furthestFloor', userId, floor);
          updateLeaderboard('mostRounds', userId, rounds);
          await interaction.update({
            content: `**Defeat - ${player.name}**\nYou dealt ${playerDamage} damage, but ${enemy.name} hit for ${enemyDamage}!\nDied on Floor ${floor}, ${rounds} rounds survived.\nLoot: ${loot.scr.toFixed(2)} SCR\nRespawn in 24h or use a Revive Stim.`,
            components: []
          });
          Object.keys(loot).forEach(key => player.active[key] = (player.active[key] || 0) + loot[key]);
          dungeonCollector.stop('death');
        } else if (enemyHp <= 0) {
          const enemyLoot = rollForMaterials(floor, enemy.name);
          const scrReward = Math.min(enemy.scrMax, enemy.scrMin + Math.random() * (enemy.scrMax - enemy.scrMin));
          loot.scr += scrReward;
          Object.keys(enemyLoot).forEach(key => loot[key] = (loot[key] || 0) + enemyLoot[key]);
          if (enemyLoot.legendaryItem) player.inventory.misc.push({ name: enemyLoot.legendaryItem });
          const lootText = Object.entries(loot).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
          await interaction.update({
            content: `**Victory - ${player.name}**\nDealt ${playerDamage} damage, defeated ${enemy.name}! It hit for ${enemyDamage}.\nHP: ${player.hp}\nLoot: ${lootText}`,
            components: [combatMenu()]
          });
        } else {
          await interaction.update({
            content: `**${dungeon.name} - Floor ${floor}**\n${player.name}, you dealt ${playerDamage} damage to ${enemy.name} (${enemyHp}/${enemy.hp} HP).\nIt hit for ${enemyDamage}. HP: ${player.hp}\nLoot: ${loot.scr.toFixed(2)} SCR`,
            components: [combatMenu()]
          });
        }
      } else if (interaction.customId === 'heal') {
        if (player.inventory.scavJuice > 0) {
          const maxHpBonus = player.equipped.weapon?.bonus?.type === 'maxHp' ? player.equipped.weapon.bonus.value : 0;
          player.hp = Math.min(50 + maxHpBonus, player.hp + 20);
          player.inventory.scavJuice -= 1;
          const enemyDamage = Math.floor(Math.random() * (enemy.attackMax - enemy.attackMin + 1) + enemy.attackMin);
          const damageResist = player.equipped.armor?.bonus?.type === 'damageResist' ? player.equipped.armor.bonus.value : 0;
          const reducedDamage = Math.max(0, Math.floor(enemyDamage * (1 - player.armor * 0.05 - damageResist)));
          player.hp -= reducedDamage;
          if (player.hp <= 0) {
            player.lastRaid = Date.now();
            updateLeaderboard('furthestFloor', userId, floor);
            updateLeaderboard('mostRounds', userId, rounds);
            await interaction.update({
              content: `**Defeat - ${player.name}**\nHealed 20 HP, but ${enemy.name} hit for ${reducedDamage}!\nDied on Floor ${floor}, ${rounds} rounds survived.\nLoot: ${loot.scr.toFixed(2)} SCR\nRespawn in 24h or use a Revive Stim.`,
              components: []
            });
            Object.keys(loot).forEach(key => player.active[key] = (player.active[key] || 0) + loot[key]);
            dungeonCollector.stop('death');
          } else {
            await interaction.update({
              content: `**${dungeon.name} - Floor ${floor}**\n${player.name}, healed 20 HP to ${player.hp}.\n${enemy.name} hit for ${reducedDamage} (${enemyHp}/${enemy.hp} HP).\nLoot: ${loot.scr.toFixed(2)} SCR`,
              components: [combatMenu()]
            });
          }
        }
      } else if (interaction.customId === 'explore' && enemyHp <= 0 && !hasExplored) {
        hasExplored = true;
        const exploreLoot = rollForMaterials(floor, enemy.name);
        Object.keys(exploreLoot).forEach(key => loot[key] = (loot[key] || 0) + exploreLoot[key]);
        if (exploreLoot.legendaryItem) player.inventory.misc.push({ name: exploreLoot.legendaryItem });
        const lootText = Object.entries(loot).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
        const nextFloorButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('next_floor').setLabel('Next Floor').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('leave').setLabel('Leave Dungeon').setStyle(ButtonStyle.Secondary)
          );
        await interaction.update({
          content: `**Exploration - ${player.name}**\nFound: ${Object.entries(exploreLoot).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')}\nTotal Loot: ${lootText}\nContinue or leave?`,
          components: [nextFloorButton]
        });
      } else if (interaction.customId === 'next_floor' && hasExplored) {
        updateLeaderboard('furthestFloor', userId, floor);
        updateLeaderboard('mostRounds', userId, rounds);
        player.furthestFloor = Math.max(player.furthestFloor, floor);
        player.roundsSurvived = Math.max(player.roundsSurvived, rounds);
        dungeonCollector.stop('next');
        await handleEndlessDungeon(player, interaction, menuMessage, dungeon, floor + 1, userId);
      } else if (interaction.customId === 'flee' || interaction.customId === 'leave') {
        updateLeaderboard('furthestFloor', userId, floor);
        updateLeaderboard('mostRounds', userId, rounds);
        player.furthestFloor = Math.max(player.furthestFloor, floor);
        player.roundsSurvived = Math.max(player.roundsSurvived, rounds);
        const lootText = Object.entries(loot).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
        await interaction.update({
          content: `**${player.name}**\nFled ${dungeon.name}!\nFloor ${floor}, ${rounds} rounds survived.\nLoot: ${lootText}\nType !menu to continue.`,
          components: []
        });
        Object.keys(loot).forEach(key => player.active[key] = (player.active[key] || 0) + loot[key]);
        dungeonCollector.stop('flee');
      }
      saveState();
    } catch (error) {
      console.error(`Dungeon error for ${player.name}:`, error.stack);
      await interaction.update({ content: `**${player.name}**\nError occurred! Loot preserved: ${loot.scr.toFixed(2)} SCR.\nUse !menu to continue.`, components: [] }).catch(() => {});
      Object.keys(loot).forEach(key => player.active[key] = (player.active[key] || 0) + loot[key]);
      dungeonCollector.stop('error');
    }
  });

  dungeonCollector.on('end', (collected, reason) => {
    console.log(`Dungeon collector ended for ${player.name}. Reason: ${reason}`);
    if (reason === 'time') {
      updateLeaderboard('furthestFloor', userId, floor);
      updateLeaderboard('mostRounds', userId, rounds);
      player.furthestFloor = Math.max(player.furthestFloor, floor);
      player.roundsSurvived = Math.max(player.roundsSurvived, rounds);
      const lootText = Object.entries(loot).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
      menuMessage.edit({
        content: `**${player.name}**\nTime’s up in ${dungeon.name}!\nFloor ${floor}, ${rounds} rounds survived.\nLoot: ${lootText}\nType !menu to continue.`,
        components: []
      }).catch(err => console.error('Failed to edit on dungeon end:', err));
      Object.keys(loot).forEach(key => player.active[key] = (player.active[key] || 0) + loot[key]);
      saveState();
    }
  });
}

client.login(TOKEN);
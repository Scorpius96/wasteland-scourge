const { Client, GatewayIntentBits } = require('discord.js');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const fs = require('fs');
require('dotenv').config();

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const WSC_COIN_TYPE = '0x0b8efbace2485175dba014eaca68556c113c111300e44155200d8ba42f93ab9d::wsc::WSC';
const WSC_PRICE = 0.10; // $0.10/WSC
const ADMIN_ADDRESS = '0xdbfb5034a49be4deba3f01f1e8455148d4657f0bc4344ac5ad39c0c121f53671';

const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));

let gameState = fs.existsSync('state.json') ? JSON.parse(fs.readFileSync('state.json')) : {
  players: {
    '695701138011455610': { suiAddress: '0xdbfb5034a49be4deba3f01f1e8455148d4657f0bc4344ac5ad39c0c121f53671' }
  },
  raiders: {
    '0xaac99018e2f0c98dd9470f7a6516454397e69aaec718673ac65c89806d1d2e6c': { 
      hp: 90, attack: 10, owner: '695701138011455610', name: 'Scorpius', active: { scr: 0, scrapMetal: 0 }, bunker: { scr: 0.01, scrapMetal: 2 }, raidsToday: 1 
    },
    '0x0973672d4b31702fd63a924bf972c5dba828e4c3a99686aa407a9c818c01632b': { 
      hp: 100, attack: 10, owner: null, name: 'Raider #2', active: { scr: 0, scrapMetal: 0 }, bunker: { scr: 0, scrapMetal: 0 }, raidsToday: 0 
    },
    '0xee3d0f7ea4d99e1878487729cfc8eae734cfcd12c3e22c74310b24ee7fb35629': { 
      hp: 100, attack: 10, owner: null, name: 'Raider #3', active: { scr: 0, scrapMetal: 0 }, bunker: { scr: 0, scrapMetal: 0 }, raidsToday: 0 
    },
    '0x927ab40e8a363656f09379f5cf96093188d9523cc7a72f42d432ad4e9c5a2b10': { 
      hp: 100, attack: 10, owner: null, name: 'Raider #4', active: { scr: 0, scrapMetal: 0 }, bunker: { scr: 0, scrapMetal: 0 }, raidsToday: 0 
    },
    '0xef6043b22228444668d7a4b442fd0bc399ed8cba2f6bfe25188ccc76d05a4a02': { 
      hp: 100, attack: 10, owner: null, name: 'Raider #5', active: { scr: 0, scrapMetal: 0 }, bunker: { scr: 0, scrapMetal: 0 }, raidsToday: 0 
    }
  }
};

// Move getName to global scope
const getName = (id) => gameState.raiders[id]?.name || id || 'Unknown';

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const suiBalance = await suiClient.getBalance({ owner: ADMIN_ADDRESS });
  console.log(`Admin SUI Balance: ${suiBalance.totalBalance} MIST`);
  setInterval(() => {
    for (const raider of Object.values(gameState.raiders)) raider.raidsToday = 0;
    saveState();
    console.log('Raids reset at', new Date().toISOString());
  }, 24 * 60 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const raiderId = args[0];

  if (command === 'register') {
    const suiAddress = args[0];
    if (!suiAddress || !suiAddress.startsWith('0x') || suiAddress.length !== 66) {
      message.reply('Usage: !register <Sui Address> (e.g., 0xdbfb5034...)—must be a 64-char hex address!');
      return;
    }
    gameState.players[message.author.id] = { suiAddress };
    message.reply(`Registered ${suiAddress} as your Bunker wallet! Get WSC on Sui Testnet to play.`);
    saveState();
  }

  if (command === 'buy') {
    if (!raiderId || !gameState.raiders[raiderId]) {
      message.reply('Raider not found! Use !status for valid IDs.');
      return;
    }
    const raider = gameState.raiders[raiderId];
    if (raider.owner) {
      message.reply(`${getName(raiderId)} is already owned!`);
      return;
    }
    const player = gameState.players[message.author.id];
    if (!player) {
      message.reply('Register your Sui address with !register first!');
      return;
    }
    const wscCost = Math.round(2 / WSC_PRICE) * 1000000; // 20 WSC in raw units
    try {
      // Fetch WSC coins
      console.log('Fetching WSC coins for:', ADMIN_ADDRESS, 'with type:', WSC_COIN_TYPE);
      const wscCoins = await suiClient.getCoins({ owner: ADMIN_ADDRESS, coinType: WSC_COIN_TYPE });
      console.log('Admin WSC Coins:', JSON.stringify(wscCoins.data, null, 2));
      if (!wscCoins.data.length) {
        throw new Error('No WSC coins found in admin wallet');
      }
      const sufficientWscCoin = wscCoins.data.find(coin => parseInt(coin.balance) >= wscCost);
      if (!sufficientWscCoin) {
        throw new Error(`No single WSC coin with balance >= ${wscCost}. Available: ${wscCoins.data.map(c => c.balance).join(', ')}`);
      }
      const wscCoinId = sufficientWscCoin.coinObjectId;
      console.log(`Selected WSC coin: ${wscCoinId}, Balance: ${sufficientWscCoin.balance}`);

      // Fetch SUI coins for gas
      const suiCoins = await suiClient.getCoins({ owner: ADMIN_ADDRESS });
      if (!suiCoins.data.length) {
        throw new Error('No SUI coins found in admin wallet for gas');
      }
      const gasCoinId = suiCoins.data[0].coinObjectId;

      // WSC Transfer Transaction
      const wscTx = new Transaction();
      const [wscCoin] = wscTx.splitCoins(wscTx.object(wscCoinId), [wscCost]);
      wscTx.transferObjects([wscCoin], player.suiAddress);
      wscTx.setGasBudget(20000000);
      wscTx.setGasPayment([{ objectId: gasCoinId, version: suiCoins.data[0].version, digest: suiCoins.data[0].digest }]);
      const wscResult = await suiClient.signAndExecuteTransaction({
        transaction: wscTx,
        signer: keypair,
        options: { showEffects: true }
      });
      console.log(`WSC Transfer Tx: ${wscResult.digest}`);

      raider.owner = message.author.id;
      message.reply(`Bought ${getName(raiderId)} for ${wscCost / 1000000} WSC!\n` +
                    `WSC Tx: ${wscResult.digest}\n` +
                    `NFT transfer skipped - placeholder ID used. Stats: HP: ${raider.hp}/100, Attack: ${raider.attack}, ` +
                    `Active: ${raider.active.scr} SCR, ${raider.active.scrapMetal} Scrap Metal, ` +
                    `Bunker: ${raider.bunker.scr} SCR, ${raider.bunker.scrapMetal} Scrap Metal, Raids Today: ${raider.raidsToday}/5`);
      updateGameState(message); // Moved inside try block
      saveState();
    } catch (error) {
      message.reply(`Buy failed: ${error.message}\nAdmin wallet (0xdbfb5034...) needs WSC (20M raw) and SUI gas (20M raw).`);
      console.error('Buy error:', error);
    }
  }

  if (command === 'raid') {
    if (!raiderId || !gameState.raiders[raiderId]) {
      message.reply('Raider not found! Use !status for valid IDs.');
      return;
    }
    const raider = gameState.raiders[raiderId];
    if (!raider.owner || raider.owner !== message.author.id) {
      message.reply(`You don’t own ${getName(raiderId)}! Check !status.`);
      return;
    }
    if (raider.raidsToday >= 5) {
      message.reply(`${getName(raiderId)} has reached the daily raid limit (5)! Wait for reset.`);
      return;
    }
    const enemy = { hp: 30, attack: 5 };
    let result = `${getName(raiderId)} vs. Ghoul:\n`;
    while (raider.hp > 0 && enemy.hp > 0) {
      enemy.hp -= raider.attack;
      result += `${getName(raiderId)} deals ${raider.attack}, Ghoul at ${enemy.hp} HP.\n`;
      if (enemy.hp > 0) {
        raider.hp -= enemy.attack;
        result += `Ghoul deals ${enemy.attack}, ${getName(raiderId)} at ${raider.hp} HP.\n`;
      }
    }
    if (raider.hp > 0) {
      raider.active.scr += 0.01;
      raider.active.scrapMetal += 2;
      raider.raidsToday += 1;
      result += `${getName(raiderId)} wins! Loot: 0.01 SCR, 2 Scrap Metal added to active inventory.\n`;
      if (Math.random() < 0.005) {
        const availableRaider = Object.entries(gameState.raiders).find(([_, r]) => !r.owner)?.[0];
        if (availableRaider) {
          const player = gameState.players[message.author.id];
          const nftTx = new Transaction();
          nftTx.transferObjects([nftTx.object(availableRaider)], player.suiAddress);
          nftTx.setGasBudget(20000000);
          const nftResult = await suiClient.signAndExecuteTransaction({ 
            transaction: nftTx, 
            signer: keypair,
            options: { showEffects: true }
          });
          gameState.raiders[availableRaider].owner = message.author.id;
          result += `Rare Drop! Claimed ${getName(availableRaider)}—Transferred to ${player.suiAddress}!\n` +
                    `NFT Tx: ${nftResult.digest}\n`;
        } else {
          result += `No unclaimed Raiders left for a drop.\n`;
        }
      }
    } else {
      result += `${getName(raiderId)} dies! Ownership reset—Raider returns to pool.\n`;
      raider.owner = null;
      raider.hp = 100;
      raider.active = { scr: 0, scrapMetal: 0 };
    }
    result += `Stats: HP: ${raider.hp}/100, Attack: ${raider.attack}, Active: ${raider.active.scr} SCR, ${raider.active.scrapMetal} Scrap Metal, ` +
              `Bunker: ${raider.bunker.scr} SCR, ${raider.bunker.scrapMetal} Scrap Metal, Raids Today: ${raider.raidsToday}/5`;
    message.reply(result);
    saveState();
  }

  if (command === 'return') {
    if (!raiderId || !gameState.raiders[raiderId]) {
      message.reply('Raider not found! Use !status for valid IDs.');
      return;
    }
    const raider = gameState.raiders[raiderId];
    if (!raider.owner || raider.owner !== message.author.id) {
      message.reply(`You don’t own ${getName(raiderId)}! Check !status.`);
      return;
    }
    raider.bunker.scr += raider.active.scr;
    raider.bunker.scrapMetal += raider.active.scrapMetal;
    raider.active = { scr: 0, scrapMetal: 0 };
    message.reply(`${getName(raiderId)} returned to Bunker.\n` +
                  `Stored: ${raider.bunker.scr} SCR, ${raider.bunker.scrapMetal} Scrap Metal.\n` +
                  `Stats: HP: ${raider.hp}/100, Attack: ${raider.attack}, Active: ${raider.active.scr} SCR, ${raider.active.scrapMetal} Scrap Metal, ` +
                  `Bunker: ${raider.bunker.scr} SCR, ${raider.bunker.scrapMetal} Scrap Metal, Raids Today: ${raider.raidsToday}/5\n` +
                  `SCR remains off-chain—track with !status.`);
    saveState();
  }

  if (command === 'name') {
    if (!raiderId || !gameState.raiders[raiderId]) {
      message.reply('Raider not found! Use !status for valid IDs.');
      return;
    }
    const raider = gameState.raiders[raiderId];
    if (!raider.owner || raider.owner !== message.author.id) {
      message.reply(`You don’t own ${getName(raiderId)}! Check !status.`);
      return;
    }
    const newName = args.slice(1).join(' ');
    if (!newName || newName.length > 20) {
      message.reply('Usage: !name <Raider ID> <New Name> (max 20 chars)');
      return;
    }
    raider.name = newName;
    message.reply(`Renamed ${raiderId} to ${newName}!\n` +
                  `Stats: HP: ${raider.hp}/100, Attack: ${raider.attack}, Active: ${raider.active.scr} SCR, ${raider.active.scrapMetal} Scrap Metal, ` +
                  `Bunker: ${raider.bunker.scr} SCR, ${raider.bunker.scrapMetal} Scrap Metal, Raids Today: ${raider.raidsToday}/5`);
    saveState();
  }

  if (command === 'status') {
    let stateText = `Wasteland Scourge - Game State\nWSC Price: $${WSC_PRICE}\nRaider Cost: ${Math.round(2 / WSC_PRICE)} WSC (~$2)\n\nPlayers:\n`;
    for (const [id, player] of Object.entries(gameState.players)) {
      stateText += `Discord ID ${id}: Sui Wallet ${player.suiAddress}\n`;
    }
    stateText += `\nRaiders:\n`;
    for (const [id, raider] of Object.entries(gameState.raiders)) {
      stateText += `${getName(id)} (${id}) - HP: ${raider.hp}/100, Attack: ${raider.attack}, Owner: ${raider.owner || 'None'}, ` +
                   `Active: ${raider.active.scr} SCR, ${raider.active.scrapMetal} Scrap Metal, ` +
                   `Bunker: ${raider.bunker.scr} SCR, ${raider.bunker.scrapMetal} Scrap Metal, Raids Today: ${raider.raidsToday}/5\n`;
    }
    message.channel.send(stateText);
  }
});

function saveState() {
  fs.writeFileSync('state.json', JSON.stringify(gameState, null, 2));
  console.log('Game state saved to state.json');
}

function updateGameState(message) {
  let stateText = `Wasteland Scourge - Updated Game State\nWSC Price: $${WSC_PRICE}\nRaider Cost: ${Math.round(2 / WSC_PRICE)} WSC (~$2)\n\nPlayers:\n`;
  for (const [id, player] of Object.entries(gameState.players)) {
    stateText += `Discord ID ${id}: Sui Wallet ${player.suiAddress}\n`;
  }
  stateText += `\nRaiders:\n`;
  for (const [id, raider] of Object.entries(gameState.raiders)) {
    stateText += `${getName(id)} (${id}) - HP: ${raider.hp}/100, Attack: ${raider.attack}, Owner: ${raider.owner || 'None'}, ` +
                 `Active: ${raider.active.scr} SCR, ${raider.active.scrapMetal} Scrap Metal, ` +
                 `Bunker: ${raider.bunker.scr} SCR, ${raider.bunker.scrapMetal} Scrap Metal, Raids Today: ${raider.raidsToday}/5\n`;
  }
  message.channel.send(stateText);
}

client.login(TOKEN);
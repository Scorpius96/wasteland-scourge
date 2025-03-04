const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography'); // Correct module

const bech32Key = 'suiprivkey1qqk0dv6typtulfr025p88lx2wnkdjyuqjwkfeegt7x3505phrvqljz64607';
const decoded = decodeSuiPrivateKey(bech32Key);
const rawPrivateKey = decoded.secretKey; // Uint8Array of 32 bytes
const base64Key = Buffer.from(rawPrivateKey).toString('base64');

console.log('Raw Base64 Private Key:', base64Key);
console.log('Length:', base64Key.length);
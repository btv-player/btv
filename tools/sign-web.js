// Firma Ed25519 degli aggiornamenti per le TV (LG / Samsung).
//   node tools/sign-web.js init       crea la chiave (se manca) e scrive la chiave pubblica in www/js/boot.js
//   node tools/sign-web.js publish    crea www/web/btv-<versione>.json, lo firma e stampa {"url","sig"} per version.json
// La password arriva solo dalla variabile d'ambiente BTV_KEY_PASSWORD (impostata da publish-release.ps1):
// la chiave privata sta cifrata in %USERPROFILE%\.btv\web-signing-key.pem, fuori dal progetto.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const buildBundle = require('./web-bundle.js');

const root = path.join(__dirname, '..');
const keyDir = process.env.BTV_KEY_DIR || path.join(os.homedir(), '.btv');
const keyFile = path.join(keyDir, 'web-signing-key.pem');
const bootFile = path.join(root, 'www', 'js', 'boot.js');
const password = process.env.BTV_KEY_PASSWORD || '';
const BASE_URL = 'https://btv-player.github.io/btv/web/';

function fail(msg) { console.error(msg); process.exit(1); }
if (password.length < 8) fail('Serve la password della chiave (almeno 8 caratteri) in BTV_KEY_PASSWORD.');

function loadOrCreateKey() {
  if (fs.existsSync(keyFile)) {
    try { return crypto.createPrivateKey({ key: fs.readFileSync(keyFile, 'utf8'), passphrase: password }); }
    catch (e) { fail('Password della chiave di firma sbagliata.'); }
  }
  const pair = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(keyFile, pair.privateKey, { mode: 0o600 });
  console.error('Creata la chiave di firma per le TV: ' + keyFile + ' (fanne una copia di sicurezza)');
  return crypto.createPrivateKey({ key: pair.privateKey, passphrase: password });
}

function publicKeyB64(priv) {
  const jwk = crypto.createPublicKey(priv).export({ format: 'jwk' });
  return Buffer.from(jwk.x, 'base64url').toString('base64');      // 32 byte grezzi, come li vuole TweetNaCl
}

function writeBootKey(pub) {
  const src = fs.readFileSync(bootFile, 'utf8');
  const next = src.replace(/var PUBKEY = '[^']*';/, "var PUBKEY = '" + pub + "';");
  if (next !== src) { fs.writeFileSync(bootFile, next); console.error('Chiave pubblica scritta in www/js/boot.js'); }
  return next !== src;
}

const cmd = process.argv[2];
const priv = loadOrCreateKey();
const pub = publicKeyB64(priv);
if (cmd === 'init') {
  writeBootKey(pub);
} else if (cmd === 'publish') {
  if (!fs.readFileSync(bootFile, 'utf8').includes("var PUBKEY = '" + pub + "';")) fail('La chiave in boot.js non è questa: esegui prima "init".');
  const bundle = buildBundle(root);
  const text = JSON.stringify(bundle);
  const sig = crypto.sign(null, Buffer.from(text, 'utf8'), priv).toString('base64');
  const outDir = path.join(root, 'updates', 'web');   // fuori da www: non finisce dentro l'APK
  fs.mkdirSync(outDir, { recursive: true });
  const name = 'btv-' + bundle.version + '.json';
  fs.writeFileSync(path.join(outDir, name), text);
  process.stdout.write(JSON.stringify({ url: BASE_URL + name, sig: sig }));
} else {
  fail('Uso: node tools/sign-web.js init|publish');
}

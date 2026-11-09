// Attiva (o disattiva) gli aggiornamenti automatici dell'app Android.
//   node tools/set-update-url.js https://TUONOME.github.io/btv/   -> l'app carica sempre la versione online
//   node tools/set-update-url.js off                                    -> l'app usa il codice incluso nell'APK
// Dopo averlo cambiato, ricompila l'APK UNA volta (tools/build-apk.ps1) e reinstallalo.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'capacitor.config.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const arg = (process.argv[2] || '').trim();

if (!arg) {
  console.log(cfg.server && cfg.server.url ? `Aggiornamenti automatici da: ${cfg.server.url}` : 'Aggiornamenti automatici: disattivati');
  process.exit(0);
}
if (arg === 'off') {
  delete cfg.server;
  console.log('Aggiornamenti automatici disattivati: l\'APK userà il codice incluso.');
} else {
  if (!/^https:\/\/[^\s]+\/$/.test(arg)) {
    console.error('Serve un indirizzo https che finisce con "/", es. https://tuonome.github.io/btv/');
    process.exit(1);
  }
  const host = new URL(arg).hostname;
  // errorPath: pagina locale mostrata se manca la connessione.
  cfg.server = { url: arg, errorPath: 'offline.html', allowNavigation: [host] };
  console.log(`Aggiornamenti automatici da: ${arg}`);
}
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('Ora ricompila l\'APK con: powershell -ExecutionPolicy Bypass -File .\\tools\\build-apk.ps1');

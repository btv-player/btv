// Copia le librerie da node_modules in www/vendor (le app TV devono funzionare senza CDN).
const fs = require('fs');
const path = require('path');

const nm = path.join(__dirname, '..', 'node_modules');
const dstDir = path.join(__dirname, '..', 'www', 'vendor');
const files = [
  ['hls.js/dist/hls.min.js', 'hls.min.js'],
  ['pako/dist/pako_inflate.es5.min.js', 'pako_inflate.min.js'], // versione ES5 per le TV più vecchie
  ['qrcode-generator/dist/qrcode.js', 'qrcode.js'],            // codice QR per "Invia dal telefono" (ES5)
  ['tweetnacl/nacl-fast.min.js', 'nacl.min.js']                // verifica firme Ed25519 degli aggiornamenti TV (ES5)
];

fs.mkdirSync(dstDir, { recursive: true });
for (const [src, dst] of files) {
  const from = path.join(nm, src);
  if (!fs.existsSync(from)) {
    console.error(`${src} non trovato: esegui prima "npm install".`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(dstDir, dst));
  console.log(`${src} -> www/vendor/${dst}`);
}

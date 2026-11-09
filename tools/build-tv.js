// Prepara la cartella dist/<tizen|webos> pronta per essere impacchettata con Tizen Studio o ares-package.
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!['tizen', 'webos'].includes(target)) {
  console.error('Uso: node tools/build-tv.js tizen|webos');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', target);
const assets = path.join(root, 'assets');

if (!fs.existsSync(path.join(root, 'www', 'vendor', 'hls.min.js'))) {
  console.error('Manca www/vendor/hls.min.js: esegui "npm install".');
  process.exit(1);
}
if (!fs.existsSync(path.join(assets, 'icon-512.png'))) require('./make-icons.js');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'www'), dist, { recursive: true });
fs.cpSync(path.join(root, 'platforms', target), dist, { recursive: true });

// Versione del pacchetto = APP_VERSION (la TV aggiorna l'app solo se la versione sale).
const appVer = (/APP_VERSION\s*=\s*'([\d.]+)'/.exec(fs.readFileSync(path.join(root, 'www', 'js', 'app.js'), 'utf8')) || [])[1] || '1.0.0';
if (target === 'webos') {
  const info = path.join(dist, 'appinfo.json');
  const j = JSON.parse(fs.readFileSync(info, 'utf8'));
  j.version = appVer;
  fs.writeFileSync(info, JSON.stringify(j, null, 2) + '\n');
} else {
  const cfgPath = path.join(dist, 'config.xml');
  fs.writeFileSync(cfgPath, fs.readFileSync(cfgPath, 'utf8').replace(/(<widget[^>]*\sversion=")[^"]*/, '$1' + appVer));
}

if (target === 'tizen') {
  fs.copyFileSync(path.join(assets, 'icon-512.png'), path.join(dist, 'icon.png'));
  // Libreria Samsung (fornita dalla TV): serve per disattivare il salvaschermo durante la visione.
  const idx = path.join(dist, 'index.html');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('<script src="vendor/hls.min.js">',
    '<script src="$WEBAPIS/webapis/webapis.js"></script>\n<script src="vendor/hls.min.js">'));
} else {
  fs.copyFileSync(path.join(assets, 'icon-80.png'), path.join(dist, 'icon.png'));
  fs.copyFileSync(path.join(assets, 'icon-130.png'), path.join(dist, 'largeIcon.png'));
  fs.copyFileSync(path.join(assets, 'splash-1920x1080.png'), path.join(dist, 'splash.png'));
}
console.log(`Pronto: ${path.relative(root, dist)}`);
console.log(target === 'tizen'
  ? 'Ora: tizen package -t wgt -s <profilo-certificato> -- dist/tizen   (vedi README)'
  : 'Ora: ares-package dist/webos   (vedi README)');

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
if (!fs.existsSync(path.join(assets, 'icon-512.png'))) { console.error('Mancano le icone: esegui tools/make-icons.ps1'); process.exit(1); }

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

// Autoaggiornamento firmato: la pagina installata è un "guscio" che avvia js/boot.js; boot sceglie tra la versione
// installata (js/base-bundle.js) e un aggiornamento scaricato e firmato (vedi www/js/boot.js).
fs.rmSync(path.join(dist, 'web'), { recursive: true, force: true });   // pacchetti firmati pubblicati: non servono qui
const buildBundle = require('./web-bundle.js');
const baseBundle = buildBundle(root);
fs.writeFileSync(path.join(dist, 'js', 'base-bundle.js'), 'window.BTV_BASE = ' + JSON.stringify(baseBundle) + ';\n');
const srcHtml = fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8');
const head = (/<head>([\s\S]*?)<\/head>/i.exec(srcHtml) || [])[1].replace(/\s*<link rel="stylesheet"[^>]*>/i, '');
fs.writeFileSync(path.join(dist, 'index.html'),
  '<!DOCTYPE html>\n<html lang="it">\n<head>' + head + '</head>\n<body>\n' +
  // Libreria Samsung (fornita dalla TV): serve per disattivare il salvaschermo durante la visione.
  (target === 'tizen' ? '<script src="$WEBAPIS/webapis/webapis.js"></script>\n' : '') +
  '<script src="vendor/nacl.min.js"></script>\n<script src="js/base-bundle.js"></script>\n<script src="js/boot.js"></script>\n</body>\n</html>\n');

if (target === 'tizen') {
  fs.copyFileSync(path.join(assets, 'icon-512.png'), path.join(dist, 'icon.png'));
} else {
  fs.copyFileSync(path.join(assets, 'icon-80.png'), path.join(dist, 'icon.png'));
  fs.copyFileSync(path.join(assets, 'icon-130.png'), path.join(dist, 'largeIcon.png'));
  fs.copyFileSync(path.join(assets, 'splash-1920x1080.png'), path.join(dist, 'splash.png'));
}
console.log(`Pronto: ${path.relative(root, dist)}`);
console.log(target === 'tizen'
  ? 'Ora: tizen package -t wgt -s <profilo-certificato> -- dist/tizen   (vedi README)'
  : 'Ora: ares-package dist/webos   (vedi README)');

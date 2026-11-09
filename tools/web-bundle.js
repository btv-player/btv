// Pacchetto del codice dell'app per le TV (LG webOS, Samsung Tizen): index.html, stile, i nostri script,
// il worker della guida e pako (per il worker). Le librerie video (hls.js, qrcode, nacl) restano quelle installate.
// Usato da build-tv.js (versione installata) e da sign-web.js (aggiornamento firmato).
const fs = require('fs');
const path = require('path');

module.exports = function buildBundle(root) {
  const www = path.join(root, 'www');
  const read = (f) => fs.readFileSync(path.join(www, f), 'utf8');
  const html = read('index.html');
  const version = (/APP_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/.exec(read('js/app.js')) || [])[1];
  if (!version) throw new Error('APP_VERSION non trovata');
  const files = { 'index.html': html, 'styles.css': read('styles.css') };
  const re = /<script src="(js\/[^"]+)"><\/script>/g;
  let m;
  while ((m = re.exec(html))) files[m[1]] = read(m[1]);
  files['js/epg-worker.js'] = read('js/epg-worker.js');
  files['vendor/pako_inflate.min.js'] = read('vendor/pako_inflate.min.js');
  return { format: 1, version: version, files: files };
};

// Server statico minimale per provare l'app nel browser: http://localhost:8080
// SOLO per lo sviluppo sul PC: ascolta solo su 127.0.0.1 e rifiuta richieste da altri siti.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const net = require('net');

const root = path.join(__dirname, '..', 'www');
const port = Number(process.env.PORT) || 8080;
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon'
};

function deny(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg || '');
}

// Indirizzi della rete locale/del PC: il proxy non deve mai raggiungerli (router, NAS, servizi locali…).
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

// Risolve il nome e blocca le destinazioni private (anche dopo i redirect).
function checkTarget(u) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(u); } catch (e) { reject(new Error('url non valido')); return; }
    if (!/^https?:$/.test(url.protocol)) { reject(new Error('solo http/https')); return; }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) { if (isPrivate(host)) reject(new Error('destinazione locale bloccata')); else resolve(url); return; }
    dns.lookup(host, { all: true }, (err, addrs) => {
      if (err) { reject(new Error('host non trovato')); return; }
      if (addrs.some(a => isPrivate(a.address))) { reject(new Error('destinazione locale bloccata')); return; }
      resolve(url);
    });
  });
}

// Proxy SOLO per lo sviluppo: nel browser molte guide/playlist non hanno intestazioni CORS.
// Sulle TV (Tizen/webOS) e su Android (HTTP nativo) non serve.
function proxy(req, res) {
  // Solo dalla nostra pagina: nessuna intestazione CORS, quindi gli altri siti non possono leggere le risposte.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') { deny(res, 403, 'vietato'); return; }
  if (req.method !== 'GET') { deny(res, 405); return; }
  const target = new URL(req.url, 'http://localhost').searchParams.get('url') || '';

  const get = (u, hops) => checkTarget(u).then(url => {
    const lib = url.protocol === 'https:' ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'BTV-dev' }, timeout: 30000 }, up => {
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && hops < 5) {
        up.resume();
        get(new URL(up.headers.location, url).toString(), hops + 1);
        return;
      }
      res.writeHead(up.statusCode, { 'Content-Type': up.headers['content-type'] || 'application/octet-stream' });
      up.pipe(res);
    }).on('timeout', function () { this.destroy(new Error('timeout')); })
      .on('error', e => { if (!res.headersSent) deny(res, 502, String(e.message)); else res.end(); });
  }).catch(e => deny(res, 400, e.message));
  get(target, 0);
}

http.createServer((req, res) => {
  // Blocca il "DNS rebinding": la richiesta deve essere indirizzata proprio a questo server.
  if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) { deny(res, 403, 'host non consentito'); return; }
  if (req.url.startsWith('/proxy?')) { proxy(req, res); return; }

  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { deny(res, 400, 'url non valido'); return; }
  const file = path.normalize(path.join(root, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath)); // come GitHub Pages
  if (file !== root && !file.startsWith(root + path.sep)) { deny(res, 403); return; }
  fs.readFile(file, (err, data) => {
    if (err) { deny(res, 404, 'Not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`BTV in esecuzione su http://localhost:${port}`));

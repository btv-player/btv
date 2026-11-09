/* Web Worker: decomprime (gzip) e analizza una guida XMLTV senza bloccare l'interfaccia. */
/* global importScripts, pako, EPG, self */
importScripts('../vendor/pako_inflate.min.js', 'epg.js');

self.onmessage = function (e) {
  try {
    var text = EPG.toText(new Uint8Array(e.data.buf), pako);
    self.postMessage({ ok: true, guide: EPG.parse(text, e.data.now) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};


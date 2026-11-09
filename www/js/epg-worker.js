/* Web Worker: decomprime (gzip) e analizza una guida XMLTV senza bloccare l'interfaccia. */
/* global importScripts, pako, EPG, self */
importScripts('../vendor/pako_inflate.min.js', 'epg.js');

self.onmessage = function (e) {
  try {
    var text = EPGText(new Uint8Array(e.data.buf));
    self.postMessage({ ok: true, guide: EPG.parse(text, e.data.now) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};

function EPGText(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = pako.ungzip(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

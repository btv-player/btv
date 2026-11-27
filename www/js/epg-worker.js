/* Web Worker: decomprime (gzip) e analizza una guida XMLTV a pezzi, senza bloccare l'interfaccia.
 * Riceve { buf, now } (byte già scaricati) oppure { url, now } (file da leggere qui, un blocco alla volta:
 * su Fire TV è il file salvato dal download nativo, così i byte non passano mai dalla pagina). */
/* global importScripts, pako, EPG, self */
importScripts('../vendor/pako_inflate.min.js', 'epg.js');

self.onmessage = function (e) {
  var d = e.data;
  function done(guide) { self.postMessage({ ok: true, guide: guide }); }
  function fail(err) { self.postMessage({ ok: false, error: String(err && err.message || err) }); }
  try {
    if (d.buf) { done(EPG.parseBytes(new Uint8Array(d.buf), pako, d.now, d.future)); return; }
    var feeder = new EPG.Feeder(pako, d.now, d.future);
    fetch(d.url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (!r.body || !r.body.getReader) {
        return r.arrayBuffer().then(function (b) { feeder.push(new Uint8Array(b), true); return feeder.finish(); });
      }
      var reader = r.body.getReader();
      return (function read() {
        return reader.read().then(function (x) {
          if (x.done) { feeder.push(new Uint8Array(0), true); return feeder.finish(); }
          feeder.push(x.value, false);
          return read();
        });
      })();
    }).then(done, fail);
  } catch (err) {
    fail(err);
  }
};

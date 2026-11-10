/*
 * Avvio di BTV sulle TV (LG webOS, Samsung Tizen) — solo nei pacchetti TV creati da tools/build-tv.js.
 * Sceglie quale codice usare:
 *   - la versione installata (window.BTV_BASE, in js/base-bundle.js), oppure
 *   - un aggiornamento scaricato dall'app (localStorage "webBundle"), SOLO se:
 *       1. la firma Ed25519 è valida con la chiave pubblica qui sotto (la privata resta sul PC di chi pubblica),
 *       2. la sua versione è più nuova di quella installata,
 *       3. l'ultimo avvio con quella versione non è fallito (altrimenti si torna da soli alla versione installata).
 * Poi carica stile, pagina e script del codice scelto.
 */
(function () {
  'use strict';
  var PUBKEY = 'ZYV94EKXJ0p+VAgRsGvVrV2oa6sTVQTWnSZhELbfbmQ=';            // chiave pubblica Ed25519 (base64), scritta da: node tools/sign-web.js init
  var base = window.BTV_BASE;
  var st = null;
  try { st = window.localStorage; } catch (e) { /* niente memoria: solo versione installata */ }

  function newer(a, b) {
    a = String(a).split('.'); b = String(b).split('.');
    for (var i = 0; i < 3; i++) { var x = +a[i] || 0, y = +b[i] || 0; if (x !== y) return x > y; }
    return false;
  }
  function b64(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function utf8(s) {
    if (window.TextEncoder) return new TextEncoder().encode(s);
    var bin = unescape(encodeURIComponent(s)), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  // Verifica la firma di un testo: usata qui all'avvio e dall'app prima di salvare un aggiornamento.
  function verify(text, sig) {
    try {
      if (!PUBKEY || !window.nacl) return false;
      var s = b64(sig), k = b64(PUBKEY);
      return s.length === 64 && k.length === 32 && window.nacl.sign.detached.verify(utf8(text), s, k);
    } catch (e) { return false; }
  }

  var chosen = base;
  try {
    var raw = st && st.getItem('webBundle');
    if (raw) {
      var w = JSON.parse(raw);
      var b = JSON.parse(w.text);
      var failedBefore = st.getItem('bundlePending') === b.version && st.getItem('bundleOk') !== b.version;
      if (!failedBefore && b && b.files && newer(b.version, base.version) && verify(w.text, w.sig)) chosen = b;
      else st.removeItem('webBundle');            // fallito, vecchio o non firmato: si torna alla versione installata
    }
    if (chosen !== base) st.setItem('bundlePending', chosen.version);
  } catch (e) {
    chosen = base;
  }
  window.BTV_BASE_VERSION = base.version;
  window.BTV_BUNDLE = chosen;
  window.BTV_VERIFY = verify;

  // stile
  var css = document.createElement('style');
  css.textContent = chosen.files['styles.css'];
  document.head.appendChild(css);

  // pagina (senza script: li carichiamo noi, nell'ordine giusto)
  var html = chosen.files['index.html'];
  var body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) || [])[1] || '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  // script nell'ordine di index.html: i nostri dal codice scelto, le librerie dai file installati
  var list = [], re = /<script src="([^"]+)"><\/script>/g, m;
  while ((m = re.exec(html))) list.push(m[1]);
  (function next(i) {
    if (i >= list.length) return;
    var src = list[i], s = document.createElement('script');
    if (typeof chosen.files[src] === 'string') {
      s.text = chosen.files[src] + '\n//# sourceURL=' + src;
      document.body.appendChild(s);
      next(i + 1);
    } else {
      s.src = src;
      s.onload = s.onerror = function () { next(i + 1); };
      document.body.appendChild(s);
    }
  })(0);
})();

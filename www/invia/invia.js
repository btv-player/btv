/* Pagina "Invia alla TV": cifra playlist, guida o accesso (utente/password) con il codice della TV e la invia tramite ntfy.sh. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var type = 'xt';
  var cache = { code: '', keys: null };

  // Il QR della TV apre .../invia/#c=CODICE: lo leggo e lo tolgo dall'indirizzo (non resta nella cronologia).
  var m = /[#&]c=([A-Za-z0-9-]+)/.exec(location.hash);
  if (m) {
    $('code').value = Pair.formatCode(Pair.normCode(m[1]));
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* non importante */ }
  } else {
    $('code').focus();
  }

  $('code').addEventListener('input', function () {
    var c = Pair.normCode(this.value).slice(0, 12);
    var f = c.length > 8 ? Pair.formatCode(c) : c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c;
    if (f !== this.value) this.value = f;
  });

  function setType(t) {
    type = t;
    ['xt', 'pl', 'epg'].forEach(function (k) { $('t-' + k).className = k === t ? 'on' : ''; });
    $('box-xt').style.display = t === 'xt' ? '' : 'none';
    $('box-url').style.display = t === 'xt' ? 'none' : '';
    $('url-l').textContent = t === 'pl' ? 'Indirizzo della playlist' : 'Indirizzo della guida XMLTV (.xml o .xml.gz)';
    $('url').placeholder = t === 'pl' ? 'https://…/lista.m3u' : 'https://…/guida.xml.gz';
    $('name').placeholder = t === 'epg' ? 'Es. Guida Italia' : 'Es. La mia lista';
  }
  ['xt', 'pl', 'epg'].forEach(function (k) { $('t-' + k).addEventListener('click', function () { setType(k); }); });
  setType('xt');

  function show(kind, text) {
    var el = $('msg');
    el.className = 'msg ' + kind;
    el.textContent = text;
  }

  $('send').addEventListener('click', function () {
    var code = Pair.normCode($('code').value);
    var name = $('name').value.trim().slice(0, 60);
    if (!Pair.validCode(code)) { show('err', 'Il codice non è valido: deve essere di 12 caratteri, come sulla TV.'); return; }
    var data = { t: type, name: name, at: Date.now() };
    if (type === 'xt') {
      data.server = $('server').value.trim();
      data.user = $('user').value.trim();
      data.pass = $('pass').value;
      if (!/^(https?:\/\/)?[^\s\/?#]+/i.test(data.server) || data.server.length > 300) { show('err', 'Inserisci l\'indirizzo del server del fornitore (es. http://server.com:8080).'); return; }
      if (!data.user || !data.pass) { show('err', 'Inserisci nome utente e password.'); return; }
    } else {
      data.url = $('url').value.trim();
      if (!/^https?:\/\/\S+$/i.test(data.url) || data.url.length > 2000) { show('err', 'Inserisci un indirizzo valido che inizi con http:// o https://'); return; }
    }
    var btn = $('send');
    btn.disabled = true;
    show('ok', 'Invio in corso…');
    setTimeout(function () {   // lascia aggiornare lo schermo prima del calcolo della chiave
      if (cache.code !== code) { cache.code = code; cache.keys = Pair.keys(code); }
      var body = Pair.encrypt(cache.keys, data);
      fetch(Pair.RELAY + cache.keys.topic, { method: 'POST', body: body, referrerPolicy: 'no-referrer' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          show('ok', 'Inviato! Sulla TV compare la conferma tra pochi secondi. Puoi inviare altro con lo stesso codice.');
          $('url').value = ''; $('name').value = ''; $('pass').value = '';
        })
        .catch(function () {
          show('err', 'Invio non riuscito: controlla la connessione e riprova.');
        })
        .then(function () { btn.disabled = false; });
    }, 30);
  });
})();

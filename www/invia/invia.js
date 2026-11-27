/* Pagina "BTV dal telefono o dal PC": con il codice della TV
 *  - aggiunge account Xtream, playlist M3U e guide (cifrati con il codice, consegnati tramite ntfy.sh);
 *  - mostra le playlist e le guide della TV e permette di attivarle o eliminarle.
 * La TV risponde sullo stesso canale, sempre cifrato, e manda solo id, nomi e stato (mai indirizzi o password). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var type = 'xt';
  var cache = { code: '', keys: null };
  var conn = { code: '', es: null, timer: null, got: false };

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
    if (Pair.validCode(c)) connect(c);
  });

  function keysFor(code) {
    if (cache.code !== code) { cache.code = code; cache.keys = Pair.keys(code); }
    return cache.keys;
  }

  function post(code, data) {
    data.at = Date.now();
    var k = keysFor(code);
    return fetch(Pair.RELAY + k.topic, { method: 'POST', body: Pair.encrypt(k, data), referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
  }

  // ---------------------------------------------------------------- Liste sulla TV
  function mbody(text) {
    var b = $('m-body');
    b.className = 'note';
    b.textContent = text;
  }

  function connect(code) {
    if (conn.code === code && conn.es) { requestList(); return; }
    if (conn.es) { try { conn.es.close(); } catch (e) { /* ignora */ } }
    var c = conn = { code: code, es: null, timer: null, got: false };
    mbody('Mi collego alla TV…');
    setTimeout(function () {                    // lascia aggiornare lo schermo prima del calcolo della chiave
      if (conn !== c) return;
      var k = keysFor(code);
      try {
        c.es = new EventSource(Pair.RELAY + k.topic + '/sse?since=' + Math.floor(Date.now() / 1000));
      } catch (e) { mbody('Questo browser non riesce a collegarsi alla TV.'); return; }
      c.es.onmessage = function (ev) {
        if (conn !== c) return;
        var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg || msg.event !== 'message' || typeof msg.message !== 'string') return;
        var d = Pair.decrypt(k, msg.message);
        if (d && d.from === 'tv' && d.t === 'state') { c.got = true; clearTimeout(c.timer); render(d); }
      };
      c.es.onopen = function () { if (conn === c && !c.asked) { c.asked = true; requestList(); } };
    }, 30);
  }

  function requestList() {
    var c = conn;
    if (!c.code) return;
    clearTimeout(c.timer);
    if (!c.got) mbody('Chiedo l\'elenco alla TV…');
    post(c.code, { t: 'list' }).catch(function () { if (conn === c) mbody('Non riesco a raggiungere la TV: controlla la connessione.'); });
    c.timer = setTimeout(function () {
      if (conn === c && !c.got) mbody('La TV non risponde: sulla TV deve essere aperta la finestra "Dal telefono o dal PC" con questo codice (il codice vale 15 minuti).');
    }, 10000);
  }

  $('refresh').addEventListener('click', function () {
    var code = Pair.normCode($('code').value);
    if (!Pair.validCode(code)) { mbody('Prima scrivi il codice mostrato sulla TV (12 caratteri).'); return; }
    conn.got = false;
    connect(code);
  });

  function btn(text, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'small' + (cls ? ' ' + cls : '');
    b.textContent = text;
    b.addEventListener('click', function () {
      if (onClick() === false) return;
      b.disabled = true;
      b.textContent = '…';
    });
    return b;
  }

  function command(data) {
    var c = conn;
    post(c.code, data).catch(function () { if (conn === c) mbody('Comando non inviato: controlla la connessione e premi Aggiorna.'); });
  }

  function row(name, kind, extra) {
    var r = document.createElement('div');
    r.className = 'item';
    var t = document.createElement('div');
    t.className = 'nm';
    t.textContent = name || 'Senza nome';
    if (kind) { var ty = document.createElement('div'); ty.className = 'ty'; ty.textContent = kind; t.appendChild(ty); }
    r.appendChild(t);
    extra.forEach(function (e) { r.appendChild(e); });
    return r;
  }

  function render(st) {
    var b = $('m-body');
    b.className = '';
    b.textContent = '';
    var sec = document.createElement('div'); sec.className = 'sec'; sec.textContent = 'Playlist';
    b.appendChild(sec);
    var pl = Array.isArray(st.pl) ? st.pl : [];
    if (!pl.length) { var e1 = document.createElement('div'); e1.className = 'note'; e1.textContent = 'Nessuna playlist: aggiungine una qui sotto.'; b.appendChild(e1); }
    pl.forEach(function (p) {
      var extra = [];
      if (p.a) { var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '✓ in uso'; extra.push(tag); }
      else extra.push(btn('Usa', 'pri', function () { command({ t: 'use', id: String(p.i) }); }));
      if (!p.f) extra.push(btn('Elimina', 'del', function () {
        if (!confirm('Eliminare "' + p.n + '" dalla TV?')) return false;
        command({ t: 'del', id: String(p.i) });
      }));
      b.appendChild(row(p.n, p.x ? 'Account Xtream' : 'Playlist M3U', extra));
    });
    var epg = Array.isArray(st.epg) ? st.epg : [];
    if (epg.length) {
      var sec2 = document.createElement('div'); sec2.className = 'sec'; sec2.textContent = 'Guide TV aggiunte';
      b.appendChild(sec2);
      epg.forEach(function (g) {
        var extra = [btn(g.o ? 'Disattiva' : 'Attiva', g.o ? '' : 'pri', function () { command({ t: 'epgOn', id: String(g.i), on: !g.o }); })];
        if (!g.f) extra.push(btn('Elimina', 'del', function () {
          if (!confirm('Eliminare la guida "' + g.n + '" dalla TV?')) return false;
          command({ t: 'epgDel', id: String(g.i) });
        }));
        b.appendChild(row(g.n, g.o ? 'Attiva' : 'Disattivata', extra));
      });
    }
  }

  // ---------------------------------------------------------------- Aggiungi
  function setType(t) {
    type = t;
    ['xt', 'pl', 'epg'].forEach(function (k) { $('t-' + k).className = k === t ? 'on' : ''; });
    $('box-xt').style.display = t === 'xt' ? '' : 'none';
    $('box-url').style.display = t === 'xt' ? 'none' : '';
    $('url-l').textContent = t === 'pl' ? 'Indirizzo della playlist M3U' : 'Indirizzo della guida XMLTV (.xml o .xml.gz)';
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
    var data = { t: type, name: name };
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
    var btnSend = $('send');
    btnSend.disabled = true;
    show('ok', 'Invio in corso…');
    if (conn.code !== code) connect(code);
    setTimeout(function () {
      post(code, data)
        .then(function () {
          show('ok', 'Inviato! Sulla TV compare la conferma tra pochi secondi e l\'elenco qui sopra si aggiorna.');
          $('url').value = ''; $('name').value = ''; $('pass').value = '';
        })
        .catch(function () {
          show('err', 'Invio non riuscito: controlla la connessione e riprova.');
        })
        .then(function () { btnSend.disabled = false; });
    }, 30);
  });

  var startCode = Pair.normCode($('code').value);
  if (Pair.validCode(startCode)) connect(startCode);
})();

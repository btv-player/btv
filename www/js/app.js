/* BTV — logica principale. JavaScript compatibile con TV del 2017+ (niente async/await, niente moduli). */
(function () {
  'use strict';

  // ---------------------------------------------------------------- Config
  var APP_VERSION = '1.7.0'; // aumentala a ogni aggiornamento: in Impostazioni vedi quale versione sta girando
  var PRESETS = [];      // nessuna lista precaricata: solo quelle che aggiungi tu
  // Guide TV gratuite in formato XMLTV (si possono disattivare o aggiungerne altre nelle Impostazioni).
  var DEFAULT_EPG = [];  // nessuna guida precaricata: quella della playlist + quelle che aggiungi tu
  var EPG_MAX_AGE = 6 * 3600e3; // ogni quanto riscaricare la guida
  // TV e Fire TV hanno poca memoria: lì si usano valori più leggeri (sul PC restano quelli pieni).
  var LOW_POWER = detectPlatform() !== 'web';
  var PAGE = LOW_POWER ? 60 : 120;                 // card renderizzate per volta
  var STREAM_TIMEOUT = 25000;  // ms prima di dichiarare un canale non disponibile
  var OSD_TIME = 5000;
  var TIMESHIFT_SECONDS = LOW_POWER ? 300 : 600;   // "torna indietro"/pausa: 5 min su TV, 10 su PC
  var BUFFER_BYTES = (LOW_POWER ? 60 : 150) * 1000 * 1000;
  var DEAD_TTL = 12 * 3600e3;  // un canale che non va resta segnato per 12 ore (poi si riprova)
  var SEEK_STEP = 30;          // secondi per ogni pressione di ◀ / ▶ / ⏪ / ⏩
  var LIVE_TOLERANCE = 6;      // entro questi secondi dalla diretta si è "in diretta"
  var AUTO_LIVE_LAG = 20;      // ritardo non voluto oltre il quale si torna da soli in diretta
  var STALL_SECONDS = 15;      // video fermo da così tanti secondi = bloccato: riavvio automatico
  var STALL_RETRIES = 3;
  var SEND_URL = 'https://btv-player.github.io/btv/invia/'; // pagina per inviare playlist/guide dal telefono o PC
  var PAIR_MINUTES = 15;          // validità del codice mostrato sulla TV       // riavvii automatici di fila prima di mostrare l'errore

  var KEYS = {
    left: [37], up: [38], right: [39], down: [40], enter: [13],
    back: [10009, 461, 27, 8],
    chup: [427, 33], chdown: [428, 34],
    fav: [403, 70],                          // Rosso, tasto F (PC)
    menu: [93],                              // Menu (Fire TV): preferito nell'elenco, lista canali nel lettore
    list: [10073, 67],                       // tasto "Lista canali" (Samsung), tasto C (PC)
    prevch: [405, 80],                       // Giallo, tasto P (PC): torna al canale precedente
    playpause: [10252, 415, 19, 179, 32],
    ff: [417, 228], rw: [412, 227],
    guide: [457, 404, 71],                   // Info, Verde, tasto G (PC)
    live: [406, 76]                          // Blu, tasto L (PC): torna in diretta
  };

  // ---------------------------------------------------------------- Stato
  var platform = detectPlatform();
  var state = {
    channels: [], groups: [], group: '__all', query: '',
    filtered: [], rendered: 0,
    favorites: Store.get('favorites', {}),
    playlists: loadPlaylists(),
    activeId: Store.get('activePlaylist', ''),
    screen: 'browse',
    playList: [], playIdx: -1, playing: null,
    hls: null, mode: null, fallbackTried: false, netRetry: false, mediaRetry: false,
    timers: {}, numBuf: '', lastBack: 0, returnFocus: null, loadToken: 0,
    epgEnabled: Store.get('epgEnabled', true),
    epgSources: loadEpgSources(),
    playlistEpg: [], epgToken: 0, epgCount: 0, epgLoading: false,
    guide: null, pair: null, multiSingle: Store.get('multiSingle', false),
    quality: Store.get('quality', 0), levels: [],
    multiPref: Store.get('multiPref', 0), multi: null, multiReturn: null, multiBrowseFocus: null, picker: null,
    resumeLast: Store.get('resumeLast', true), resumed: false, prevUrl: null,
    hideDead: Store.get('hideDead', false), dead: loadDead()
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    screens: { browse: $('browse'), player: $('player'), settings: $('settings'), multi: $('multi') },
    multiGrid: $('multi-grid'), multiBtn: $('btn-multi'), multiPref: $('multi-pref'), picker: $('picker'), pickerList: $('picker-list'),
    groups: $('groups'), grid: $('grid'), search: $('search'), status: $('status'),
    plName: $('playlist-name'), settingsBtn: $('btn-settings'),
    video: $('video'), spinner: $('spinner'), perr: $('player-error'), numjump: $('numjump'),
    osd: $('osd'), osdFav: $('osd-fav'), osdQuality: $('osd-quality'), osdShift: $('osd-shift'),
    osdLive: $('osd-live'), osdPause: $('osd-pause'), liveBadge: $('live-badge'),
    osdPrev: $('osd-prev'), osdAudio: $('osd-audio'), osdSubs: $('osd-subs'),
    optResume: $('opt-resume'), optDead: $('opt-dead'),
    plList: $('pl-list'), plNameIn: $('pl-name'), plUrlIn: $('pl-url'),
    epgList: $('epg-list'), epgUrlIn: $('epg-url'), epgToggle: $('epg-toggle'), epgStatus: $('epg-status'),
    guide: $('guide'), guideList: $('guide-list'),
    toast: $('toast'), pair: $('pair')
  };

  // ---------------------------------------------------------------- Piattaforma
  function detectPlatform() {
    if (window.tizen) return 'tizen';
    if (window.PalmSystem || window.webOS || /web0s|webos/i.test(navigator.userAgent)) return 'webos';
    var C = window.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform()) return 'android';
    return 'web';
  }

  function capPlugin(name) {
    var C = window.Capacitor;
    return C && C.Plugins && C.Plugins[name] ? C.Plugins[name] : null;
  }

  function registerTvKeys() {
    if (platform === 'tizen') {
      ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaFastForward', 'MediaRewind', 'Info',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (k) {
        try { window.tizen.tvinputdevice.registerKey(k); } catch (e) { /* tasto non presente */ }
      });
    }
    if (platform === 'android') {
      var App = capPlugin('App');
      if (App) {
        App.addListener('backButton', function () { handleAction('back'); });
        App.addListener('appStateChange', function (s) { setBackground(!s.isActive); });
      }
    }
  }

  function exitApp() {
    stopStream();
    try {
      if (platform === 'tizen') window.tizen.application.getCurrentApplication().exit();
      else if (platform === 'android') { var App = capPlugin('App'); if (App) App.exitApp(); }
      else if (platform === 'webos') { if (window.webOS && window.webOS.platformBack) window.webOS.platformBack(); else window.close(); }
      else toast('Nel browser non è possibile chiudere l\'app');
    } catch (e) { window.close(); }
  }

  // ---------------------------------------------------------------- Schermo acceso e sottofondo
  // Durante la visione niente salvaschermo: Fire TV (plugin nativo "Screen"), Samsung (webapis / tizen.power), browser (Wake Lock).
  // Su LG webOS il salvaschermo è già sospeso dal sistema mentre un video è in riproduzione.
  var screenOn = false, wakeLock = null, background = false;
  function keepScreenOn(on) {
    if (background) on = false;
    if (on === screenOn) return;
    screenOn = on;
    try {
      if (platform === 'tizen') {
        var ac = window.webapis && window.webapis.appcommon;
        if (ac && ac.setScreenSaver) ac.setScreenSaver(on ? ac.AppCommonScreenSaverState.SCREEN_SAVER_OFF : ac.AppCommonScreenSaverState.SCREEN_SAVER_ON);
        else if (window.tizen.power) { if (on) window.tizen.power.request('SCREEN', 'SCREEN_NORMAL'); else window.tizen.power.release('SCREEN'); }
      } else if (platform === 'android') {
        var S = capPlugin('Screen');
        if (S) S.keepOn({ on: on });
      } else if (navigator.wakeLock) {
        if (on) {
          navigator.wakeLock.request('screen').then(function (l) {
            if (screenOn) wakeLock = l; else l.release();
          }, function () { /* non consentito: pazienza */ });
        } else if (wakeLock) { wakeLock.release(); wakeLock = null; }
      }
    } catch (e) { /* funzione non disponibile su questo dispositivo */ }
  }

  // Tasto Home / altra app: ferma lo streaming (niente banda, audio o memoria sprecati) e riprendi al ritorno.
  function setBackground(hidden) {
    if (hidden === background) return;
    background = hidden;
    if (hidden) {
      if (state.screen === 'player' && state.playing) stopStream();
      else if (state.screen === 'multi' && state.multi) state.multi.tiles.forEach(function (t, i) { tileStop(i); });
      keepScreenOn(false);
      return;
    }
    if (state.screen === 'player' && state.playing) { startStream(state.playing); showOsd(false); }
    else if (state.screen === 'multi' && state.multi) {
      state.multi.tiles.forEach(function (t, i) { if (t.ch) tileLoad(i, t.ch); });
    }
    keepScreenOn(state.screen === 'player' || state.screen === 'multi');
  }
  document.addEventListener('visibilitychange', function () { setBackground(!!document.hidden); });

  // ---------------------------------------------------------------- Utilità
  // Icona + testo su un elemento; non riscrive il DOM se non è cambiato niente (alcune chiamate sono ogni secondo).
  function setIc(e, icon, text) {
    var k = JSON.stringify([icon, text]);
    if (e._ic === k) return;
    e._ic = k;
    Icons.set(e, icon, text);
  }

  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(state.timers.toast);
    state.timers.toast = setTimeout(function () { el.toast.classList.add('hidden'); }, ms || 2500);
  }

  // ---------------------------------------------------------------- Canali che non funzionano
  // { url: momento dell'ultimo errore }: dopo DEAD_TTL si riprova da soli.
  function loadDead() {
    var d = Store.get('dead', {}), now = Date.now(), out = {};
    Object.keys(d).forEach(function (u) { if (now - d[u] < DEAD_TTL) out[u] = d[u]; });
    return out;
  }

  function setDead(url, isDead) {
    if (!url || !!state.dead[url] === isDead) return;
    if (isDead) state.dead[url] = Date.now(); else delete state.dead[url];
    Store.set('dead', state.dead);
    Array.prototype.forEach.call(el.grid.children, function (card) {
      var c = state.filtered[+card.getAttribute('data-idx')];
      if (c && c.url === url) card.classList.toggle('dead', isDead);
    });
  }

  // Gli URL delle playlist personali spesso contengono utente e password: a schermo e nei log mostriamo solo il sito.
  function maskUrl(u) {
    var m = /^([a-z]+:\/\/)(?:[^@\/]*@)?([^\/?#]+)(.*)$/i.exec(String(u || ''));
    if (!m) return '…';
    return m[1] + m[2] + (m[3] && m[3] !== '/' ? '/…' : '');
  }

  function safeUrl(u) { return /^(https?:)?\/\//i.test(u || '') || /^data:image\//i.test(u || ''); }

  function initials(name) {
    var s = document.createElement('span');
    s.className = 'initials';
    var words = String(name).replace(/\(.*?\)|\[.*?\]/g, '').trim().split(/\s+/);
    s.textContent = ((words[0] || '?').charAt(0) + (words[1] ? words[1].charAt(0) : '')).toUpperCase();
    return s;
  }

  function cleanName(name) {
    // "Rai 1 (1080p) [Geo-blocked]" -> "Rai 1"
    return String(name).replace(/\s*\((\d{3,4}p|\d+k)\)/gi, '').replace(/\s*\[[^\]]*\]/g, '').trim() || name;
  }

  function fillLogo(box, ch) {
    box.innerHTML = '';
    if (safeUrl(ch.logo)) {
      var img = new Image();
      img.alt = '';
      img.setAttribute('loading', 'lazy');
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); box.appendChild(initials(ch.name)); };
      img.src = ch.logo;
      box.appendChild(img);
    } else {
      box.appendChild(initials(ch.name));
    }
  }

  // ---------------------------------------------------------------- Playlist
  function loadPlaylists() {
    var custom = Store.get('playlists', []);
    return PRESETS.concat(custom.filter(function (p) { return p && p.url && !p.preset; }));
  }

  function saveCustomPlaylists() {
    Store.set('playlists', state.playlists.filter(function (p) { return !p.preset; }));
  }

  function activePlaylist() {
    for (var i = 0; i < state.playlists.length; i++) if (state.playlists[i].id === state.activeId) return state.playlists[i];
    return state.playlists[0] || null;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Proxy disponibile solo con "npm run dev" (il browser applica CORS, le TV e Android no).
  function devProxy(url) {
    return platform === 'web' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/proxy?url=' + encodeURIComponent(url) : null;
  }

  // GET testuale o binario (Uint8Array).
  function httpGet(url, binary) {
    // Su Android usa l'HTTP nativo di Capacitor: niente blocchi CORS.
    var Http = platform === 'android' ? capPlugin('CapacitorHttp') : null;
    if (Http) {
      return Http.get({ url: url, responseType: binary ? 'arraybuffer' : 'text' }).then(function (r) {
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        if (!binary) return typeof r.data === 'string' ? r.data : String(r.data);
        return typeof r.data === 'string' ? b64ToBytes(r.data) : new Uint8Array(r.data);
      });
    }
    function direct(u) {
      return fetch(u).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return binary ? r.arrayBuffer().then(function (b) { return new Uint8Array(b); }) : r.text();
      });
    }
    return direct(url).catch(function (err) {
      var p = devProxy(url);
      if (!p) throw err;
      return direct(p);
    });
  }

  function fetchText(url) { return httpGet(url, false); }

  function loadActive() {
    var pl = activePlaylist();
    var token = ++state.loadToken;
    if (!pl) { showWelcome(); return; }
    if (state.activeId !== pl.id) { state.activeId = pl.id; Store.set('activePlaylist', pl.id); }
    el.plName.textContent = pl.name;
    setStatus('Caricamento di “' + pl.name + '”…');
    state.channels = []; state.filtered = []; el.grid.innerHTML = '';
    fetchText(pl.url).then(function (text) {
      if (token !== state.loadToken) return;
      var list = M3U.parse(text);
      if (!list.length) throw new Error('la playlist è vuota o non è un file M3U');
      Store.set('cache:' + pl.id, { t: Date.now(), text: text });
      setChannels(list);
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      var cache = Store.get('cache:' + pl.id, null);
      if (cache && cache.text) {
        setChannels(M3U.parse(cache.text));
        toast('Offline: uso la copia salvata della playlist', 4000);
      } else {
        setChannels([]);
        setStatus('Impossibile caricare la playlist (' + (err && err.message ? err.message : 'errore di rete') + '). Controlla la connessione o l\'URL nelle Impostazioni.', true);
      }
    });
  }

  // Prima apertura (o nessuna playlist): tre modi per aggiungere la propria lista.
  function showWelcome() {
    state.channels = []; state.filtered = []; state.groups = [];
    el.plName.textContent = '';
    setStatus('');
    renderGroups();
    el.grid.innerHTML = '';
    var w = document.createElement('div');
    w.className = 'welcome';
    w.innerHTML = '<div class="wl-title">Benvenuto in BTV</div>' +
      '<div class="wl-sub">BTV è un lettore: non contiene canali. Aggiungi la tua playlist o accedi con le credenziali del tuo fornitore.</div>' +
      '<div class="wl-buttons">' +
      '<button class="btn focusable primary" data-action="openPair">' + Icons.svg('phone') + 'Dal telefono o dal PC</button>' +
      '<button class="btn focusable" data-action="openLogin">' + Icons.svg('settings') + 'Accedi con utente e password</button>' +
      '<button class="btn focusable" data-action="openSettings">' + Icons.svg('list') + 'Inserisci l\'indirizzo</button>' +
      '</div>';
    el.grid.appendChild(w);
    if (state.screen === 'browse') Nav.setRoot(el.screens.browse, w.querySelector('.btn'));
  }

  // Login "Xtream Codes": server + utente + password del fornitore. Si ricavano playlist M3U e guida XMLTV.
  function xtreamServer(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^https?:/i.test(u)) return '';   // solo http/https
    if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
    return /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[^\s?#]*)?$/i.test(u) ? u : '';
  }

  function addXtream(server, user, pass, name) {
    var srv = xtreamServer(server);
    if (!srv || !user || !pass) { toast('Servono indirizzo del server, nome utente e password'); return null; }
    var q = 'username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass);
    var url = srv + '/get.php?' + q + '&type=m3u_plus&output=m3u8';
    var p = addPlaylistUrl(name || ('Account ' + srv.replace(/^https?:\/\//, '')), url);
    // la guida del fornitore (la playlist m3u_plus di solito la indica già: così è sicura)
    addEpgUrl('Guida del fornitore', srv + '/xmltv.php?' + q);
    // verifica delle credenziali: avvisa se il fornitore le rifiuta (la playlist resta, si può eliminare)
    httpGet(srv + '/player_api.php?' + q).then(function (txt) {
      var j = null; try { j = JSON.parse(txt); } catch (e) { /* risposta non JSON */ }
      if (j && j.user_info && String(j.user_info.auth) === '0') toast('Il fornitore ha rifiutato nome utente o password', 6000);
      else if (j && j.user_info && j.user_info.exp_date) {
        var d = new Date(+j.user_info.exp_date * 1000);
        if (!isNaN(d)) toast('Accesso riuscito · abbonamento valido fino al ' + d.toLocaleDateString('it-IT'), 5000);
      }
    }, function () { /* server non raggiungibile ora: lo dirà il caricamento della playlist */ });
    return p;
  }

  function setChannels(list) {
    list.forEach(function (ch, i) {
      ch.num = parseInt(ch.chno, 10) || (i + 1);
      ch.title = cleanName(ch.name);
    });
    state.channels = list;
    state.playlistEpg = list.epgUrls || [];
    var counts = {};
    list.forEach(function (ch) { ch.groups.forEach(function (g) { counts[g] = (counts[g] || 0) + 1; }); });
    state.groups = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); })
      .map(function (g) { return { id: g, name: g, count: counts[g] }; });
    if (state.group !== '__all' && state.group !== '__fav' && !counts[state.group]) state.group = '__all';
    renderGroups();
    applyFilter();
    if (state.screen === 'browse') {
      var c = Nav.current();
      if (!c || !document.body.contains(c)) Nav.setRoot(el.screens.browse, el.grid.children[0] || activeGroupEl());
    }
    if (list.length) loadEpg(false);
    // All'avvio riparte dall'ultimo canale visto (come una TV); si disattiva nelle Impostazioni.
    if (!state.resumed && list.length) {
      state.resumed = true;
      var last = Store.get('lastChannel', null);
      var li = -1;
      for (var k = 0; last && k < list.length; k++) if (list[k].url === last) { li = k; break; }
      if (state.resumeLast && li >= 0 && state.screen === 'browse') {
        Nav.setRoot(el.screens.browse, focusCardFor(list[li]) || el.grid.children[0]);
        openPlayer(list, li);
      }
    }
  }

  // ---------------------------------------------------------------- Guida TV (EPG)
  function loadEpgSources() {
    var saved = Store.get('epgSources', null) || [];
    var on = {};
    saved.forEach(function (s) { on[s.id] = s.on !== false; });
    return DEFAULT_EPG.map(function (d) {
      return { id: d.id, name: d.name, url: d.url, preset: true, on: on.hasOwnProperty(d.id) ? on[d.id] : true };
    }).concat(saved.filter(function (s) { return s && !s.preset && s.url; }));
  }

  function saveEpgSources() { Store.set('epgSources', state.epgSources); }

  function epgUrls() {
    if (!state.epgEnabled) return [];
    var urls = state.playlistEpg.slice();
    state.epgSources.forEach(function (s) { if (s.on !== false && urls.indexOf(s.url) < 0) urls.push(s.url); });
    return urls;
  }

  function guideText(bytes) {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (!window.pako) throw new Error('gzip non supportato');
      bytes = window.pako.ungzip(bytes);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Analisi in un Web Worker (l'interfaccia resta fluida); se non disponibile, sul thread principale.
  var epgWorker = null, epgWorkerBroken = false;
  function parseGuide(bytes, now) {
    function onMain() { return EPG.parse(guideText(bytes), now); }
    if (epgWorkerBroken || !window.Worker) return Promise.resolve().then(onMain);
    return new Promise(function (resolve, reject) {
      try {
        if (!epgWorker) epgWorker = new Worker('js/epg-worker.js');
      } catch (e) {
        epgWorkerBroken = true;
        try { resolve(onMain()); } catch (x) { reject(x); }
        return;
      }
      epgWorker.onmessage = function (e) { if (e.data.ok) resolve(e.data.guide); else reject(new Error(e.data.error)); };
      epgWorker.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        epgWorkerBroken = true; epgWorker = null;
        try { resolve(onMain()); } catch (x) { reject(x); }
      };
      var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      epgWorker.postMessage({ buf: buf, now: now }, [buf]);
    });
  }

  function attachGuides(guides) {
    state.epgCount = EPG.match(state.channels, guides);
    refreshEpgViews();
  }

  function clearEpg() {
    state.channels.forEach(function (ch) { ch.epg = null; });
    state.epgCount = 0;
    refreshEpgViews();
  }

  function loadEpg(force) {
    var urls = epgUrls();
    var token = ++state.epgToken;
    var pl = activePlaylist();
    if (!urls.length || !pl) { state.epgLoading = false; clearEpg(); return; }

    var cache = Store.get('epg:' + pl.id, null);
    if (cache && cache.data && !force) attachGuides([cache.data]);
    if (!force && cache && Date.now() - cache.t < EPG_MAX_AGE) { state.epgLoading = false; updateEpgLabel(); return; }

    state.epgLoading = true; updateEpgLabel();
    var guides = [], failed = [], i = 0, now = Date.now();
    (function next() {
      if (token !== state.epgToken) return;
      if (i >= urls.length) {
        state.epgLoading = false;
        if (guides.length) {
          attachGuides(guides);
          // Una sola guida in cache (la playlist attiva) per non riempire la memoria della TV.
          state.playlists.forEach(function (p) { if (p.id !== pl.id) Store.remove('epg:' + p.id); });
          Store.set('epg:' + pl.id, { t: Date.now(), data: EPG.compact(guides, state.channels) });
        } else if (!cache) {
          clearEpg();
        }
        if (failed.length && force) toast('Guida: ' + failed.length + ' fonte/i non raggiungibili', 3500);
        updateEpgLabel();
        return;
      }
      var url = urls[i++];
      httpGet(url, true)
        .then(function (bytes) { return parseGuide(bytes, now); })
        .then(function (g) {
          guides.push(g);
          // Alleggerimento: se le guide scaricate coprono già quasi tutti i canali, salta le altre fonti
          // (risparmia download e lavoro alla Fire TV; la guida della playlist viene sempre provata per prima).
          if (state.channels.length && EPG.match(state.channels, guides) >= state.channels.length * 0.9) i = urls.length;
        })
        .catch(function (e) { failed.push(url); if (window.console) console.warn('Guida TV non caricata:', maskUrl(url), e && e.message); })
        .then(next);
    })();
  }

  function updateEpgLabel() {
    var pl = activePlaylist();
    var txt = pl ? pl.name : '';
    if (state.epgLoading) txt += '  ·  caricamento guida…';
    else if (state.epgCount) txt += '  ·  guida per ' + state.epgCount + ' canali';
    el.plName.textContent = txt;
    if (el.epgStatus) {
      el.epgStatus.textContent = !state.epgEnabled ? 'Disattivata' :
        state.epgLoading ? 'Caricamento…' : (state.epgCount ? 'Programmi disponibili per ' + state.epgCount + ' canali' : 'Nessun canale abbinato');
    }
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function progress(p, now) { return Math.max(0, Math.min(100, (now - p[0]) / (p[1] - p[0]) * 100)); }
  function dayLabel(t) {
    var d = new Date(t), today = new Date();
    var diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
    if (diff === 0) return 'Oggi';
    if (diff === 1) return 'Domani';
    if (diff === -1) return 'Ieri';
    return ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'][d.getDay()] + ' ' + d.getDate();
  }

  function fillCardEpg(card, ch, now) {
    var nn = EPG.nowNext(ch.epg, now);
    var line = card.querySelector('.cnow');
    var bar = card.querySelector('.cbar');
    if (nn.now) {
      line.textContent = nn.now[2];
      bar.firstChild.style.width = progress(nn.now, now) + '%';
      bar.style.display = '';
    } else {
      line.textContent = nn.next ? 'Alle ' + hhmm(nn.next[0]) + ': ' + nn.next[2] : '';
      bar.style.display = 'none';
    }
  }

  // Aggiorna card visibili, barra info e pannello guida (chiamata ogni minuto e dopo il caricamento).
  function refreshEpgViews() {
    var now = Date.now();
    Array.prototype.forEach.call(el.grid.children, function (card) {
      var ch = state.filtered[+card.getAttribute('data-idx')];
      if (ch) fillCardEpg(card, ch, now);
    });
    if (state.screen === 'player' && osdVisible()) fillOsdEpg();
    if (state.guide) renderGuide(false);
    if (state.multi) state.multi.tiles.forEach(function (t) { if (t.ch) fillTileEpg(t); });
    updateEpgLabel();
  }

  function setStatus(msg, isError) {
    el.status.textContent = msg || '';
    el.status.className = isError ? 'error' : '';
  }

  // ---------------------------------------------------------------- Elenco
  function favCount() {
    var n = 0;
    state.channels.forEach(function (ch) { if (state.favorites[ch.url]) n++; });
    return n;
  }

  function renderGroups() {
    el.groups.innerHTML = '';
    var items = [
      { id: '__fav', name: 'Preferiti', icon: 'starf', count: favCount() },
      { id: '__all', name: 'Tutti i canali', count: state.channels.length }
    ].concat(state.groups);
    items.forEach(function (g) {
      var b = document.createElement('div');
      b.className = 'group focusable' + (g.id === state.group ? ' active' : '');
      b.setAttribute('data-group', g.id);
      var n = document.createElement('span'); n.className = 'gname';
      if (g.icon) setIc(n, g.icon, g.name); else n.textContent = g.name;
      var c = document.createElement('span'); c.className = 'gcount'; c.textContent = g.count;
      b.appendChild(n); b.appendChild(c);
      el.groups.appendChild(b);
    });
  }

  function activeGroupEl() {
    return el.groups.querySelector('.group.active') || el.groups.firstChild;
  }

  function selectGroup(id) {
    if (state.group === id) return;
    state.group = id;
    Array.prototype.forEach.call(el.groups.children, function (g) {
      g.classList.toggle('active', g.getAttribute('data-group') === id);
    });
    applyFilter();
  }

  function applyFilter() {
    if (!activePlaylist()) { showWelcome(); return; }   // nessuna playlist: resta il benvenuto
    var q = state.query.toLowerCase();
    var g = state.group;
    state.filtered = state.channels.filter(function (ch) {
      if (g === '__fav') { if (!state.favorites[ch.url]) return false; }
      else if (g !== '__all' && ch.groups.indexOf(g) < 0) return false;
      if (state.hideDead && state.dead[ch.url]) return false;
      return !q || ch.name.toLowerCase().indexOf(q) >= 0;
    });
    el.grid.innerHTML = '';
    el.grid.scrollTop = 0;
    state.rendered = 0;
    renderMore();
    if (!state.channels.length) return;
    if (!state.filtered.length) {
      setStatus(g === '__fav' && !q ? 'Nessun preferito: premi Menu o il tasto Rosso su un canale per aggiungerlo.' : 'Nessun canale trovato.');
    } else {
      setStatus(state.filtered.length + (state.filtered.length === 1 ? ' canale' : ' canali') + (q ? ' per “' + state.query + '”' : ''));
    }
  }

  function renderMore() {
    var end = Math.min(state.filtered.length, state.rendered + PAGE);
    var frag = document.createDocumentFragment();
    for (var i = state.rendered; i < end; i++) frag.appendChild(makeCard(state.filtered[i], i));
    el.grid.appendChild(frag);
    state.rendered = end;
  }

  function makeCard(ch, i) {
    var d = document.createElement('div');
    d.className = 'card focusable' + (state.favorites[ch.url] ? ' fav' : '') + (state.dead[ch.url] ? ' dead' : '');
    d.setAttribute('data-idx', i);
    var logo = document.createElement('div'); logo.className = 'clogo';
    fillLogo(logo, ch);
    var name = document.createElement('div'); name.className = 'cname'; name.textContent = ch.title;
    var num = document.createElement('div'); num.className = 'cnum'; num.textContent = ch.num;
    var star = document.createElement('div'); star.className = 'cstar'; star.innerHTML = Icons.svg('starf');
    var now = document.createElement('div'); now.className = 'cnow';
    var bar = document.createElement('div'); bar.className = 'cbar'; bar.appendChild(document.createElement('i'));
    d.appendChild(logo); d.appendChild(name); d.appendChild(now); d.appendChild(num); d.appendChild(star); d.appendChild(bar);
    fillCardEpg(d, ch, Date.now());
    return d;
  }

  function gridCols() {
    var c = el.grid.children;
    if (c.length < 2) return 1;
    var top = c[0].offsetTop;
    for (var i = 1; i < c.length; i++) if (c[i].offsetTop !== top) return i;
    return c.length;
  }

  // Regole di navigazione specifiche dell'elenco (più veloci e prevedibili della geometria).
  function customNav(from, dir) {
    if (state.screen === 'browse') {
      if (from.classList.contains('card')) {
        var i = +from.getAttribute('data-idx');
        var cols = gridCols();
        var col = i % cols;
        if ((dir === 'down') && i + cols * 3 >= state.rendered && state.rendered < state.filtered.length) renderMore();
        var cards = el.grid.children;
        if (dir === 'right') return (col < cols - 1 && cards[i + 1]) ? cards[i + 1] : false;
        if (dir === 'left') return col > 0 ? cards[i - 1] : activeGroupEl();
        if (dir === 'down') {
          if (cards[i + cols]) return cards[i + cols];
          if (Math.floor((cards.length - 1) / cols) > Math.floor(i / cols)) return cards[cards.length - 1];
          return false;
        }
        if (dir === 'up') return i - cols >= 0 ? cards[i - cols] : el.search;
      }
      if (from.classList.contains('group')) {
        if (dir === 'right') {
          clearTimeout(state.timers.group);
          selectGroup(from.getAttribute('data-group'));
          return el.grid.children[0] || el.search;
        }
        if (dir === 'up' && !from.previousSibling) return false;
        if (dir === 'down' && !from.nextSibling) return false;
        if (dir === 'up') return from.previousSibling;
        if (dir === 'down') return from.nextSibling;
      }
      if (from === el.search || from === el.multiBtn || from === el.settingsBtn) {
        if (dir === 'down') return el.grid.children[0] || activeGroupEl();
        if (dir === 'up') return false;
        if (from === el.search) return dir === 'left' ? activeGroupEl() : el.multiBtn;
        if (from === el.multiBtn) return dir === 'left' ? el.search : el.settingsBtn;
        return dir === 'left' ? el.multiBtn : false;
      }
    }
    if (state.screen === 'player' && (dir === 'up' || dir === 'down')) return false;
    return null;
  }

  // Seleziona la categoria quando il focus ci si ferma sopra.
  function onFocusChange() {
    var c = Nav.current();
    clearTimeout(state.timers.group);
    if (c && c.classList.contains('group')) {
      state.timers.group = setTimeout(function () { selectGroup(c.getAttribute('data-group')); }, 280);
    }
  }

  function toggleFav(ch) {
    if (!ch) return;
    if (state.favorites[ch.url]) delete state.favorites[ch.url];
    else state.favorites[ch.url] = true;
    var saved = Store.set('favorites', state.favorites);
    var isFav = !!state.favorites[ch.url];
    if (!saved) toast('Memoria piena: preferiti non salvati. Elimina una playlist che non usi.', 5000);
    else toast(isFav ? 'Aggiunto ai preferiti: ' + ch.title : 'Rimosso dai preferiti: ' + ch.title);
    // aggiorna card e contatore senza ridisegnare tutto
    Array.prototype.forEach.call(el.grid.children, function (card) {
      var c = state.filtered[+card.getAttribute('data-idx')];
      if (c && c.url === ch.url) card.classList.toggle('fav', isFav);
    });
    var favGroup = el.groups.querySelector('[data-group="__fav"] .gcount');
    if (favGroup) favGroup.textContent = favCount();
    updateOsdFav();
  }

  // ---------------------------------------------------------------- Schermate
  function show(name, focusEl) {
    state.screen = name;
    Object.keys(el.screens).forEach(function (k) { el.screens[k].classList.toggle('active', k === name); });
    if (name === 'player') Nav.setRoot(el.osd, null);
    else Nav.setRoot(el.screens[name], focusEl);
    keepScreenOn(name === 'player' || name === 'multi');
  }

  function openSettings() {
    state.returnFocus = Nav.current();
    renderPlaylists();
    renderEpgSources();
    updateMultiPrefLabel();
    updateOptLabels();
    $('app-version').textContent = 'BTV versione ' + APP_VERSION + '  ·  ' + platform +
      (platform === 'android' && /^https:/.test(location.href) && !/localhost/.test(location.host) ? '  ·  aggiornamenti automatici attivi' : '');
    show('settings');
  }

  function closeSettings() {
    show('browse', state.returnFocus);
  }

  function renderPlaylists() {
    el.plList.innerHTML = '';
    state.playlists.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'pl-row' + (p.id === state.activeId ? ' current' : '');
      var info = document.createElement('div'); info.className = 'pl-info';
      var n = document.createElement('div'); n.className = 'pl-name'; n.textContent = p.name + (p.id === state.activeId ? '  ·  in uso' : '');
      var u = document.createElement('div'); u.className = 'pl-url'; u.textContent = p.preset ? p.url : maskUrl(p.url);
      info.appendChild(n); info.appendChild(u);
      row.appendChild(info);
      var use = document.createElement('button');
      use.className = 'btn focusable' + (p.id === state.activeId ? ' primary' : '');
      if (p.id === state.activeId) setIc(use, 'check', 'In uso'); else use.textContent = 'Usa';
      use.setAttribute('data-action', 'usePlaylist'); use.setAttribute('data-id', p.id);
      row.appendChild(use);
      if (!p.preset) {
        var del = document.createElement('button');
        del.className = 'btn focusable danger'; del.textContent = 'Elimina';
        del.setAttribute('data-action', 'deletePlaylist'); del.setAttribute('data-id', p.id);
        row.appendChild(del);
      }
      el.plList.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- Lettore
  function openPlayer(list, idx) {
    state.returnFocus = Nav.current();
    state.playList = list.slice();
    show('player');
    playIndex(idx);
  }

  function closePlayer() {
    if (state.multiReturn) { returnToMulti(); return; }
    stopStream();
    hideOsd();
    if (state.guide) closeGuide();
    el.perr.classList.add('hidden');
    show('browse', focusCardFor(state.playing) || state.returnFocus);
  }

  function focusCardFor(ch) {
    if (!ch) return null;
    for (var i = 0; i < state.filtered.length; i++) {
      if (state.filtered[i].url === ch.url) {
        while (state.rendered <= i) renderMore();
        return el.grid.children[i];
      }
    }
    return null;
  }

  function playIndex(i) {
    var n = state.playList.length;
    if (!n) return;
    i = ((i % n) + n) % n;
    state.playIdx = i;
    if (state.playing && state.playing.url !== state.playList[i].url) state.prevUrl = state.playing.url;
    state.playing = state.playList[i];
    state.stallRetries = 0;
    Store.set('lastChannel', state.playing.url);
    startStream(state.playing);
    showOsd(false);
  }

  function hlsJsSupported() { return !!(window.Hls && window.Hls.isSupported()); }

  function startStream(ch) {
    stopStream();
    el.perr.classList.add('hidden');
    el.spinner.classList.add('on');
    state.fallbackTried = false; state.netRetry = false; state.mediaRetry = false;
    state.userShift = false;
    state.levels = [];
    state.started = false; state.stallSec = 0; state.okSec = 0; state.lastTime = -1;
    var url = ch.url;
    var looksHls = /\.m3u8?(\?|$)|\/hls\/|m3u8/i.test(url);
    // hls.js per primo: permette di scegliere la qualità e di tornare indietro (timeshift).
    // Se fallisce (es. server senza CORS) si passa al lettore nativo della TV.
    if (looksHls && hlsJsSupported()) playWithHlsJs(url);
    else playNative(url);
    clearTimeout(state.timers.stream);
    state.timers.stream = setTimeout(function () { fail('Il canale non risponde.'); }, STREAM_TIMEOUT);
  }

  function playNative(url) {
    state.mode = 'native';
    state.levels = [];
    el.video.src = url;
    tryPlay();
  }

  function playWithHlsJs(url) {
    state.mode = 'hlsjs';
    var Hls = window.Hls;
    var hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      // Timeshift: conserva ciò che hai già visto e continua a scaricare mentre sei in pausa.
      backBufferLength: TIMESHIFT_SECONDS,
      maxBufferLength: TIMESHIFT_SECONDS,
      maxMaxBufferLength: TIMESHIFT_SECONDS,
      maxBufferSize: BUFFER_BYTES,
      manifestLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 3
    });
    state.hls = hls;
    hls.on(Hls.Events.ERROR, function (ev, data) {
      if (!data.fatal || state.hls !== hls) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !state.netRetry && data.details !== 'manifestLoadError') {
        state.netRetry = true; hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !state.mediaRetry) {
        state.mediaRetry = true; hls.recoverMediaError();
      } else {
        fail(data.details === 'manifestLoadError' ? 'Il server del canale non risponde o blocca la riproduzione.' : 'Errore di riproduzione (' + data.details + ').');
      }
    });
    hls.on(Hls.Events.MANIFEST_PARSED, function (ev, data) {
      state.levels = (data.levels || hls.levels || []).map(function (l, idx) { return { idx: idx, height: l.height || 0, bitrate: l.bitrate || 0 }; });
      applyQuality();
      tryPlay();
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, updateQualityLabel);
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, applyTrackPrefs);
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, applyTrackPrefs);
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, updateTrackButtons);
    hls.loadSource(url);
    hls.attachMedia(el.video);
  }

  function tryPlay() {
    var p = el.video.play();
    if (p && p.catch) p.catch(function () { /* autoplay bloccato: l'utente può premere Play */ });
  }

  // Se il metodo scelto fallisce, prova l'altro una volta prima di mostrare l'errore.
  function fail(msg) {
    if (state.screen !== 'player' || !state.playing) return;
    if (!state.fallbackTried) {
      state.fallbackTried = true;
      var url = state.playing.url;
      if (state.mode === 'native' && hlsJsSupported()) { destroyHls(); playWithHlsJs(url); return; }
      if (state.mode === 'hlsjs') { destroyHls(); playNative(url); return; }
    }
    clearTimeout(state.timers.stream);
    el.spinner.classList.remove('on');
    el.perr.querySelector('.perr-msg').textContent = msg + ' Alcuni canali sono attivi solo in certi orari o paesi.';
    setDead(state.playing.url, true);
    el.perr.classList.remove('hidden');
  }

  function destroyHls() {
    if (state.hls) { try { state.hls.destroy(); } catch (e) { /* ignora */ } state.hls = null; }
  }

  function stopStream() {
    clearTimeout(state.timers.stream);
    destroyHls();
    var v = el.video;
    try { v.pause(); } catch (e) { /* ignora */ }
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* ignora */ }
    el.spinner.classList.remove('on');
  }

  el.video.addEventListener('playing', function () {
    if (state.playing) setDead(state.playing.url, false);
    state.started = true;
    clearTimeout(state.timers.stream);
    el.spinner.classList.remove('on');
    el.perr.classList.add('hidden');
  });
  el.video.addEventListener('waiting', function () { if (state.screen === 'player') el.spinner.classList.add('on'); });

  // Video bloccato a metà (rete o server): dopo STALL_SECONDS senza avanzare riavvia il canale da solo,
  // al massimo STALL_RETRIES volte di fila; poi mostra l'errore. Controllato ogni secondo.
  function playerWatchdog() {
    var v = el.video;
    if (background || !state.started || v.paused || v.seeking || !el.perr.classList.contains('hidden')) { state.stallSec = 0; return; }
    if (v.currentTime !== state.lastTime) {
      state.lastTime = v.currentTime; state.stallSec = 0;
      if (state.stallRetries && ++state.okSec > 120) { state.stallRetries = 0; state.okSec = 0; }  // 2 minuti filati: tutto ok
      return;
    }
    if (++state.stallSec < STALL_SECONDS) return;
    state.stallSec = 0; state.okSec = 0;
    if (state.stallRetries < STALL_RETRIES) {
      state.stallRetries++;
      toast('Il canale si è bloccato: lo riavvio (' + state.stallRetries + '/' + STALL_RETRIES + ')…');
      startStream(state.playing);
    } else {
      state.started = false;
      fail('Il canale continua a bloccarsi.');
    }
  }
  el.video.addEventListener('error', function () {
    if (state.screen === 'player' && state.mode === 'native' && el.video.getAttribute('src')) fail('Formato non supportato o canale offline.');
  });

  // ---------------------------------------------------------------- Qualità
  // state.quality = altezza preferita (0 = automatica), ricordata tra un canale e l'altro.
  function qualityOptions() {
    var hs = [];
    state.levels.forEach(function (l) { if (l.height && hs.indexOf(l.height) < 0) hs.push(l.height); });
    hs.sort(function (a, b) { return b - a; });
    return [0].concat(hs);
  }

  function applyQuality() {
    var hls = state.hls;
    if (!hls || !state.levels.length) { updateQualityLabel(); return; }
    if (!state.quality) { hls.currentLevel = -1; updateQualityLabel(); return; }
    // Il livello più alto che non supera la qualità scelta (o il più basso disponibile).
    var best = null;
    state.levels.forEach(function (l) {
      if (l.height <= state.quality && (!best || l.height > best.height || (l.height === best.height && l.bitrate > best.bitrate))) best = l;
    });
    if (!best) best = state.levels.reduce(function (a, b) { return a.height <= b.height ? a : b; });
    hls.currentLevel = best.idx;
    updateQualityLabel();
  }

  function updateQualityLabel() {
    var btn = el.osdQuality;
    if (!btn) return;
    var hls = state.hls;
    var cur = hls && hls.currentLevel >= 0 && state.levels[hls.currentLevel] ? state.levels[hls.currentLevel].height : 0;
    var label = state.quality ? state.quality + 'p' : 'Auto' + (cur ? ' (' + cur + 'p)' : '');
    setIc(btn, 'quality', label);
  }

  function cycleQuality() {
    var opts = qualityOptions();
    if (state.mode !== 'hlsjs' || opts.length < 2) {
      toast('Questo canale trasmette in una sola qualità');
      return;
    }
    var i = opts.indexOf(state.quality);
    state.quality = opts[(i + 1) % opts.length];
    Store.set('quality', state.quality);
    applyQuality();
    toast('Qualità: ' + (state.quality ? state.quality + 'p' : 'automatica'));
  }

  // ---------------------------------------------------------------- Lingua audio e sottotitoli
  function trackLabel(t) { return t ? String(t.lang || t.name || '?').toUpperCase().slice(0, 3) : '?'; }

  // Applica la lingua audio / i sottotitoli scelti l'ultima volta (se il canale li ha).
  function applyTrackPrefs() {
    var h = state.hls;
    if (!h) return;
    var aLang = Store.get('audioLang', ''), sLang = Store.get('subsLang', '');
    (h.audioTracks || []).forEach(function (t, i) { if (aLang && t.lang === aLang && h.audioTrack !== i) h.audioTrack = i; });
    var si = -1;
    (h.subtitleTracks || []).forEach(function (t, i) { if (sLang && t.lang === sLang && si < 0) si = i; });
    h.subtitleTrack = si;
    h.subtitleDisplay = si >= 0;
    updateTrackButtons();
  }

  function updateTrackButtons() {
    var h = state.mode === 'hlsjs' ? state.hls : null;
    var a = h && h.audioTracks || [], s = h && h.subtitleTracks || [];
    el.osdAudio.classList.toggle('hidden', a.length < 2);
    if (a.length > 1) setIc(el.osdAudio, 'audio', trackLabel(a[h.audioTrack] || a[0]));
    el.osdSubs.classList.toggle('hidden', !s.length);
    if (s.length) setIc(el.osdSubs, 'subs', h.subtitleDisplay && h.subtitleTrack >= 0 ? trackLabel(s[h.subtitleTrack]) : 'No');
  }

  function cycleAudio() {
    var h = state.hls, a = h && h.audioTracks || [];
    if (a.length < 2) { toast('Questo canale ha una sola lingua audio'); return; }
    var n = (h.audioTrack + 1) % a.length;
    h.audioTrack = n;
    Store.set('audioLang', a[n].lang || '');
    toast('Audio: ' + (a[n].name || trackLabel(a[n])));
    updateTrackButtons();
  }

  function cycleSubs() {
    var h = state.hls, s = h && h.subtitleTracks || [];
    if (!s.length) { toast('Questo canale non ha sottotitoli'); return; }
    var cur = h.subtitleDisplay ? h.subtitleTrack : -1;
    var n = cur + 1 >= s.length ? -1 : cur + 1;   // … → ultima lingua → spenti
    h.subtitleTrack = n;
    h.subtitleDisplay = n >= 0;
    Store.set('subsLang', n >= 0 ? (s[n].lang || '') : '');
    toast(n >= 0 ? 'Sottotitoli: ' + (s[n].name || trackLabel(s[n])) : 'Sottotitoli spenti');
    updateTrackButtons();
  }

  // ---------------------------------------------------------------- Timeshift
  // Intervallo in cui ci si può spostare: finestra DVR del canale + ciò che è già in memoria.
  function shiftRange() {
    var v = el.video, start = Infinity, end = -Infinity, i;
    for (i = 0; i < v.seekable.length; i++) { start = Math.min(start, v.seekable.start(i)); end = Math.max(end, v.seekable.end(i)); }
    for (i = 0; i < v.buffered.length; i++) { start = Math.min(start, v.buffered.start(i)); end = Math.max(end, v.buffered.end(i)); }
    if (state.hls && state.hls.liveSyncPosition) end = Math.max(end, state.hls.liveSyncPosition);
    if (!isFinite(start) || !isFinite(end) || end - start < 5) return null;
    return { start: start, end: end };
  }

  // Secondi di ritardo rispetto alla diretta. hls.js riproduce sempre qualche segmento dietro al bordo
  // (liveSyncPosition): quella è la "diretta" normale, non va mostrata come ritardo.
  function behindLive() {
    var r = shiftRange();
    if (!r) return 0;
    var ref = (state.hls && state.hls.liveSyncPosition) || (r.end - 20);
    var b = ref - el.video.currentTime;
    return b > LIVE_TOLERANCE ? b : 0;
  }

  function fmtDur(s) {
    s = Math.round(s);
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(sec);
  }

  function seekBy(sec) {
    var r = shiftRange();
    if (!r) { toast('Questo canale non permette di tornare indietro'); return; }
    var v = el.video;
    var t = Math.max(r.start + 1, Math.min(r.end - 3, v.currentTime + sec));
    if (sec < 0 && v.currentTime - r.start < 2) toast('Non puoi andare più indietro: inizio della registrazione');
    v.currentTime = t;
    state.userShift = true;                 // ritardo voluto: niente ritorno automatico alla diretta
    if (v.paused && sec > 0) tryPlay();
    showOsd(false);
    updateShift();
    setTimeout(function () { if (!behindLive()) state.userShift = false; updateLiveBadge(); }, 600);
  }

  function goLive(silent) {
    var r = shiftRange();
    if (r) el.video.currentTime = Math.max(r.start, (state.hls && state.hls.liveSyncPosition) || (r.end - 10));
    state.userShift = false;
    tryPlay();
    if (!silent) showOsd(false);
    updateShift();
    updateLiveBadge();
  }

  function togglePause() {
    if (el.video.paused) { tryPlay(); } else { el.video.pause(); state.userShift = true; }
    showOsd(false);
    updateShift();
  }

  // Badge "Torna in diretta" sempre visibile (anche con la barra chiusa) quando si è indietro.
  // Se il ritardo NON è voluto (rallentamenti della rete), torna in diretta da solo.
  function updateLiveBadge() {
    if (state.screen !== 'player' || !state.playing) { el.liveBadge.classList.add('hidden'); return; }
    var b = behindLive();
    var v = el.video;
    if (b && !state.userShift && !v.paused && Date.now() - (state.lastAutoLive || 0) > 30000 && b > AUTO_LIVE_LAG) {
      state.lastAutoLive = Date.now();
      goLive(true);
      toast('Il canale era rimasto indietro: riportato in diretta');
      return;
    }
    if (b) {
      setIc(el.liveBadge, [[v.paused ? 'pause' : 'rewind', '−' + fmtDur(b)], ['live', 'Torna in diretta' + (osdVisible() ? '' : '  (OK)')]]);
      el.liveBadge.classList.remove('hidden');
    } else {
      el.liveBadge.classList.add('hidden');
    }
  }

  function updateShift() {
    var box = el.osdShift;
    if (!box) return;
    var b = behindLive(), r = shiftRange();
    var paused = el.video.paused && el.video.readyState > 0;
    var icon, txt;
    if (paused) { icon = 'pause'; txt = 'In pausa' + (b ? ' · −' + fmtDur(b) + ' dalla diretta' : ''); }
    else if (b) { icon = 'rewind'; txt = '−' + fmtDur(b) + ' dalla diretta'; }
    else { icon = 'dot'; txt = 'IN DIRETTA'; }
    if (r) txt += '   ·   puoi tornare indietro fino a ' + fmtDur(r.end - r.start);
    setIc(box, icon, txt);
    box.classList.toggle('live', !paused && !b);
    el.osdLive.classList.toggle('primary', !!b);
    setIc(el.osdPause, el.video.paused ? 'play' : 'pause');
  }

  // ---------------------------------------------------------------- Barra info (OSD)
  function showOsd(withFocus) {
    var ch = state.playing;
    if (!ch) return;
    fillLogo(el.osd.querySelector('.osd-logo'), ch);
    el.osd.querySelector('.osd-num').textContent = ch.num;
    el.osd.querySelector('.osd-name').textContent = ch.title;
    el.osd.querySelector('.osd-group').textContent = ch.groups.join(' · ') + '   (' + (state.playIdx + 1) + '/' + state.playList.length + ')';
    updateOsdFav();
    fillOsdEpg();
    updateQualityLabel();
    updateTrackButtons();
    el.osdPrev.classList.toggle('hidden', !state.prevUrl);
    setIc(el.osd.querySelector('[data-action="closePlayer"]'), 'back', state.multiReturn ? 'Multivisione' : 'Canali');
    updateShift();
    el.osd.classList.remove('hidden');
    if (withFocus) Nav.setRoot(el.osd, Nav.current() && el.osd.contains(Nav.current()) ? Nav.current() : el.osdPause);
    clearTimeout(state.timers.osd);
    state.timers.osd = setTimeout(hideOsd, el.video.paused ? OSD_TIME * 3 : OSD_TIME);
  }

  function fillOsdEpg() {
    var ch = state.playing;
    var box = el.osd.querySelector('.osd-epg');
    var now = Date.now();
    var nn = EPG.nowNext(ch && ch.epg, now);
    if (!nn.now && !nn.next) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    el.osd.querySelector('.osd-now').textContent = nn.now ? hhmm(nn.now[0]) + ' – ' + hhmm(nn.now[1]) + '   ' + nn.now[2] : 'Nessuna informazione sul programma in onda';
    el.osd.querySelector('.osd-bar i').style.width = (nn.now ? progress(nn.now, now) : 0) + '%';
    el.osd.querySelector('.osd-next').textContent = nn.next ? 'Dopo: ' + hhmm(nn.next[0]) + '   ' + nn.next[2] : '';
  }

  function hideOsd() {
    clearTimeout(state.timers.osd);
    el.osd.classList.add('hidden');
  }

  function osdVisible() { return !el.osd.classList.contains('hidden'); }

  function updateOsdFav() {
    var on = state.playing && state.favorites[state.playing.url];
    setIc(el.osdFav, on ? 'starf' : 'star');
    el.osdFav.classList.toggle('primary', !!on);
  }

  function typeDigit(d) {
    state.numBuf = (state.numBuf + d).slice(-4);
    el.numjump.textContent = state.numBuf;
    el.numjump.classList.remove('hidden');
    clearTimeout(state.timers.num);
    state.timers.num = setTimeout(function () {
      var n = parseInt(state.numBuf, 10);
      state.numBuf = '';
      el.numjump.classList.add('hidden');
      for (var i = 0; i < state.channels.length; i++) {
        if (state.channels[i].num === n) {
          if (state.guide) closeGuide();
          if (state.picker) closePicker();
          if (state.screen === 'multi') tileLoad(state.multi.focus, state.channels[i]);
          else if (state.screen === 'player') { state.playList = state.channels.slice(); playIndex(i); }
          else openPlayer(state.channels, i);
          return;
        }
      }
      toast('Canale ' + n + ' inesistente');
    }, 1500);
  }

  // ---------------------------------------------------------------- Pannello guida del canale
  function openGuide(list, idx) {
    if (!list || !list[idx]) return;
    hideOsd();
    state.guide = { list: list, idx: idx, sel: 0, items: [] };
    el.guide.classList.remove('hidden');
    renderGuide(true);
  }

  function closeGuide() {
    state.guide = null;
    el.guide.classList.add('hidden');
  }

  function renderGuide(resetSel) {
    var g = state.guide;
    var ch = g.list[g.idx];
    var now = Date.now();
    fillLogo(el.guide.querySelector('.guide-logo'), ch);
    el.guide.querySelector('.guide-ch').textContent = ch.num + '   ' + ch.title;
    var progs = ch.epg || [];
    var start = EPG.currentIndex(progs, now);
    if (start < 0) { start = 0; while (start < progs.length && progs[start][1] <= now) start++; }
    g.items = progs.slice(start, start + 80);
    if (resetSel) g.sel = 0;
    g.sel = Math.max(0, Math.min(g.sel, g.items.length - 1));

    el.guideList.innerHTML = '';
    if (!g.items.length) {
      var empty = document.createElement('div');
      empty.className = 'guide-empty';
      empty.textContent = state.epgLoading ? 'Caricamento della guida in corso…' :
        (state.epgEnabled ? 'Nessuna informazione sulla guida per questo canale.' : 'La guida TV è disattivata nelle Impostazioni.');
      el.guideList.appendChild(empty);
    }
    var lastDay = '';
    g.items.forEach(function (p, i) {
      var day = dayLabel(p[0]);
      if (day !== lastDay) {
        var h = document.createElement('div'); h.className = 'guide-day'; h.textContent = day;
        el.guideList.appendChild(h);
        lastDay = day;
      }
      var row = document.createElement('div');
      var live = p[0] <= now && p[1] > now;
      row.className = 'gi' + (live ? ' live' : '') + (i === g.sel ? ' sel' : '');
      row.setAttribute('data-i', i);
      var t = document.createElement('div'); t.className = 'gi-time'; t.textContent = hhmm(p[0]);
      var b = document.createElement('div'); b.className = 'gi-body';
      var ti = document.createElement('div'); ti.className = 'gi-title'; ti.textContent = p[2];
      b.appendChild(ti);
      if (live) {
        var bar = document.createElement('div'); bar.className = 'gi-bar';
        var fill = document.createElement('i'); fill.style.width = progress(p, now) + '%';
        bar.appendChild(fill); b.appendChild(bar);
      }
      row.appendChild(t); row.appendChild(b);
      if (live) { var badge = document.createElement('div'); badge.className = 'gi-badge'; badge.textContent = 'IN ONDA'; row.appendChild(badge); }
      el.guideList.appendChild(row);
    });
    guideSelect(g.sel);
  }

  function guideSelect(i) {
    var g = state.guide;
    var desc = el.guide.querySelector('.guide-desc');
    if (!g.items.length) { desc.classList.add('hidden'); return; }
    g.sel = Math.max(0, Math.min(i, g.items.length - 1));
    Array.prototype.forEach.call(el.guideList.querySelectorAll('.gi'), function (r) {
      var on = +r.getAttribute('data-i') === g.sel;
      r.classList.toggle('sel', on);
      if (on) { if (r.scrollIntoViewIfNeeded) r.scrollIntoViewIfNeeded(false); else r.scrollIntoView({ block: 'nearest' }); }
    });
    var p = g.items[g.sel];
    desc.classList.remove('hidden');
    desc.querySelector('.gd-title').textContent = p[2];
    desc.querySelector('.gd-meta').textContent = dayLabel(p[0]) + '  ' + hhmm(p[0]) + ' – ' + hhmm(p[1]) +
      '  ·  ' + Math.round((p[1] - p[0]) / 60000) + ' min' + (p[4] ? '  ·  ' + p[4] : '');
    desc.querySelector('.gd-text').textContent = p[3] || '';
  }

  function guideAction(a) {
    var g = state.guide;
    switch (a) {
      case 'up': guideSelect(g.sel - 1); return true;
      case 'down': guideSelect(g.sel + 1); return true;
      case 'left': case 'chdown':
        g.idx = (g.idx - 1 + g.list.length) % g.list.length; renderGuide(true); return true;
      case 'right': case 'chup':
        g.idx = (g.idx + 1) % g.list.length; renderGuide(true); return true;
      case 'enter':
        var list = g.list, idx = g.idx;
        closeGuide();
        if (state.screen === 'multi') {
          tileLoad(state.multi.focus, list[idx]);
        } else if (state.screen === 'player') {
          if (list === state.playList && idx === state.playIdx) showOsd(false);
          else { state.playList = list.slice(); playIndex(idx); }
        } else {
          openPlayer(list, idx);
        }
        return true;
      case 'back': case 'guide':
        closeGuide();
        if (state.screen === 'player') showOsd(true);
        return true;
    }
    return a.indexOf('digit') === 0 ? false : true;
  }

  // ---------------------------------------------------------------- Impostazioni guida
  function renderEpgSources() {
    setIc(el.epgToggle, 'guide', state.epgEnabled ? 'Guida TV: attiva' : 'Guida TV: disattivata');
    el.epgToggle.classList.toggle('primary', state.epgEnabled);
    el.epgList.innerHTML = '';
    var rows = state.playlistEpg.map(function (u) { return { id: '', name: 'Indicata dalla playlist', url: u, fromPlaylist: true, on: true }; })
      .concat(state.epgSources);
    rows.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'pl-row' + (s.on !== false && state.epgEnabled ? ' current' : '');
      var info = document.createElement('div'); info.className = 'pl-info';
      var n = document.createElement('div'); n.className = 'pl-name'; n.textContent = s.name;
      var u = document.createElement('div'); u.className = 'pl-url'; u.textContent = s.preset ? s.url : maskUrl(s.url);
      info.appendChild(n); info.appendChild(u); row.appendChild(info);
      if (!s.fromPlaylist) {
        var t = document.createElement('button');
        t.className = 'btn focusable' + (s.on !== false ? ' primary' : '');
        if (s.on !== false) setIc(t, 'check', 'Attiva'); else t.textContent = 'Disattivata';
        t.setAttribute('data-action', 'toggleEpgSource'); t.setAttribute('data-id', s.id);
        row.appendChild(t);
        if (!s.preset) {
          var d = document.createElement('button');
          d.className = 'btn focusable danger'; d.textContent = 'Elimina';
          d.setAttribute('data-action', 'deleteEpgSource'); d.setAttribute('data-id', s.id);
          row.appendChild(d);
        }
      }
      el.epgList.appendChild(row);
    });
    updateEpgLabel();
  }

  function epgChanged(focusSel) {
    saveEpgSources();
    renderEpgSources();
    Nav.setRoot(el.screens.settings, focusSel ? el.screens.settings.querySelector(focusSel) : null);
    loadEpg(true);
  }

  // ---------------------------------------------------------------- Multivisione
  // Quanti video insieme regge il dispositivo: le TV Samsung/LG e le Fire TV Stick hanno pochi decoder video.
  function deviceTiles() {
    if (platform === 'tizen' || platform === 'webos') return 2;
    var mem = navigator.deviceMemory;
    if (platform === 'android') return mem && mem >= 4 ? 4 : 2;
    return 4;
  }

  // Scelta dell'utente nelle Impostazioni (0 = automatico in base al dispositivo).
  function maxTiles() { return state.multiPref || deviceTiles(); }

  function updateOptLabels() {
    setIc(el.optResume, 'play', 'All\'avvio: ' + (state.resumeLast ? 'ultimo canale' : 'elenco canali'));
    setIc(el.optDead, 'warning', 'Canali non funzionanti: ' + (state.hideDead ? 'nascosti' : 'visibili (attenuati)'));
  }

  function updateMultiPrefLabel() {
    var b = el.multiPref;
    if (!b) return;
    setIc(b, 'multi', 'Riquadri: ' + (state.multiPref ? state.multiPref : 'Automatico (' + deviceTiles() + ')'));
  }

  function channelByUrl(url) {
    for (var i = 0; i < state.channels.length; i++) if (state.channels[i].url === url) return state.channels[i];
    return null;
  }

  function buildTiles(n) {
    el.multiGrid.innerHTML = '';
    el.multiGrid.className = 'n' + n;
    var tiles = [];
    for (var i = 0; i < n; i++) {
      var t = document.createElement('div');
      t.className = 'tile focusable empty';
      t.setAttribute('data-i', i);
      t.innerHTML =
        '<video playsinline muted></video>' +
        '<div class="tile-empty">' + Icons.svg('plus') + 'Aggiungi canale<small>premi OK</small></div>' +
        '<div class="tile-spin"><div class="ring"></div></div>' +
        '<div class="tile-err hidden"></div>' +
        '<div class="tile-label"><span class="tl-num"></span><span class="tl-name"></span><div class="tl-now"></div></div>' +
        '<div class="tile-standby"><canvas class="ts-shot"></canvas><div class="ts-logo"></div><div class="ts-hint">' + Icons.svg('play') + 'Selezionalo per guardarlo</div></div>' +
        '<div class="tile-audio">' + Icons.svg('audio') + '</div>' +
        '<button class="tile-live hidden">' + Icons.svg('live') + 'Diretta</button>' +
        '<div class="tile-menu hidden">' +
        '<button class="btn tbtn" data-act="full">' + Icons.svg('fullscreen') + 'Schermo intero</button>' +
        '<button class="btn tbtn" data-act="live">' + Icons.svg('live') + 'Diretta</button>' +
        '<button class="btn tbtn" data-act="change">' + Icons.svg('swap') + 'Cambia canale</button>' +
        '<button class="btn tbtn" data-act="remove">' + Icons.svg('close') + 'Togli</button></div>';
      el.multiGrid.appendChild(t);
      tiles.push({ el: t, video: t.querySelector('video'), ch: null, hls: null, mode: null, fallback: false, timer: null });
    }
    return tiles;
  }

  function openMulti(firstCh, focusIdx) {
    if (!state.channels.length) { toast('Nessun canale caricato'); return; }
    stopStream(); hideOsd(); if (state.guide) closeGuide();
    var n = maxTiles();
    var saved = Store.get('multiTiles', []);
    if (focusIdx >= n) focusIdx = 0;
    var chans = [];
    for (var i = 0; i < n; i++) chans.push(saved[i] ? channelByUrl(saved[i]) : null);
    if (firstCh) {
      var dup = -1;
      chans.forEach(function (c, j) { if (c && c.url === firstCh.url) dup = j; });
      if (dup >= 0) chans[dup] = chans[0];
      chans[0] = firstCh;
    }
    if (state.screen === 'browse') state.multiBrowseFocus = Nav.current();
    var f = focusIdx || 0;
    state.multi = { tiles: buildTiles(n), focus: f, menu: -1, menuSel: 0, shotTick: 0 };
    show('multi', state.multi.tiles[f].el);
    chans.forEach(function (c, j) { if (c) tileLoad(j, c); });
    updateTileAudio();
    Array.prototype.forEach.call(el.screens.multi.querySelectorAll('.mlayout'), function (b) {
      b.classList.toggle('primary', +b.getAttribute('data-n') === n);
    });
  }

  // Cambia 2 ⇄ 4 riquadri direttamente dalla multivisione (stessa scelta delle Impostazioni).
  function setMultiLayout(n) {
    if (!state.multi) return;
    state.multiPref = n;
    Store.set('multiPref', n);
    updateMultiPrefLabel();
    var f = Math.min(state.multi.focus, n - 1);
    closeMulti(false);
    openMulti(null, f);
    if (n === 4 && deviceTiles() < 4) toast('Attenzione: questo dispositivo potrebbe non reggere 4 canali insieme', 4000);
    else toast(n + ' riquadri');
  }

  // Dalla multivisione allo schermo intero: Indietro riporta alla multivisione.
  function returnToMulti() {
    var r = state.multiReturn;
    state.multiReturn = null;
    var saved = Store.get('multiTiles', []);
    if (state.playing) saved[r.tile] = state.playing.url; // se hai cambiato canale a schermo intero, il riquadro lo segue
    Store.set('multiTiles', saved);
    stopStream(); hideOsd(); if (state.guide) closeGuide();
    el.perr.classList.add('hidden');
    openMulti(null, r.tile);
  }

  function closeMulti(toBrowse) {
    var m = state.multi;
    if (!m) return;
    // Conserva anche i riquadri oltre quelli visibili (passando da 4 a 2 e poi di nuovo a 4 non si perdono).
    var saved = Store.get('multiTiles', []);
    m.tiles.forEach(function (t, i) { saved[i] = t.ch ? t.ch.url : null; });
    Store.set('multiTiles', saved.slice(0, 4));
    m.tiles.forEach(function (t, i) { tileStop(i); });
    state.multi = null;
    el.multiGrid.innerHTML = '';
    if (toBrowse !== false) show('browse', state.multiBrowseFocus);
  }

  function tileStop(i) {
    var t = state.multi.tiles[i];
    clearTimeout(t.timer);
    if (t.hls) { try { t.hls.destroy(); } catch (e) { /* ignora */ } t.hls = null; }
    try { t.video.pause(); } catch (e) { /* ignora */ }
    t.video.removeAttribute('src');
    try { t.video.load(); } catch (e) { /* ignora */ }
    t.el.classList.remove('loading');
    t.played = false; t.dTime = 0;
  }

  // Riquadro in attesa (solo TV con un decoder): niente video, si vedono logo, nome e programma in onda.
  function tileStandby(i) {
    var t = state.multi.tiles[i];
    tileSnapshot(t);
    tileStop(i);
    if (!t.ch) return;
    t.el.classList.add('standby');
    t.el.classList.toggle('has-shot', t.shotUrl === t.ch.url);
    t.el.querySelector('.tile-err').classList.add('hidden');
    fillLogo(t.el.querySelector('.ts-logo'), t.ch);
  }

  // Anteprima: un fotogramma piccolo (320 px) del riquadro mentre va. Sulle TV che mostrano il video su un piano
  // hardware separato il fotogramma può risultare nero: in quel caso non lo usiamo e resta il logo.
  function tileSnapshot(t) {
    var v = t.video;
    if (!t.ch || !v.videoWidth || v.readyState < 2) return;
    try {
      var c = t.el.querySelector('.ts-shot');
      var w = 320, h = Math.round(320 * v.videoHeight / v.videoWidth) || 180;
      var tmp = t.shotTmp || (t.shotTmp = document.createElement('canvas'));
      tmp.width = w; tmp.height = h;
      var x = tmp.getContext('2d');
      x.drawImage(v, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h).data, lit = 0;
      for (var p = 0; p < d.length; p += 4 * 97) if (d[p] + d[p + 1] + d[p + 2] > 60) lit++;
      if (lit < 8) return;                          // nero: niente anteprima vera su questo dispositivo
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(tmp, 0, 0);
      t.shotUrl = t.ch.url;
    } catch (e) { /* video di un altro dominio senza CORS: niente anteprima */ }
  }

  // Molte TV LG/Samsung danno alle app un solo decoder video: il secondo riquadro "ruba" il video al primo.
  // Quando succede si passa (e si resta) in modalità "un video alla volta": va il riquadro selezionato.
  function enableSingleVideo() {
    var m = state.multi;
    if (state.multiSingle || !m) return;
    state.multiSingle = true;
    Store.set('multiSingle', true);
    m.tiles.forEach(function (t, j) { if (j !== m.focus && t.ch) tileStandby(j); });
    var f = m.tiles[m.focus];
    if (f.ch) tileLoad(m.focus, f.ch);
    toast('Questa TV riproduce un solo video alla volta: in multivisione va il riquadro selezionato, gli altri mostrano cosa c\'è in onda', 7000);
  }

  function tileFail(i, msg) {
    var m = state.multi; if (!m) return;
    var t = m.tiles[i];
    if (!state.multiSingle && (platform === 'webos' || platform === 'tizen') &&
        m.tiles.some(function (o, j) { return j !== i && o.played; })) { enableSingleVideo(); return; } // limite della TV, non del canale
    if (!t.fallback && t.ch) {
      t.fallback = true;
      var url = t.ch.url;
      if (t.mode === 'hlsjs') { if (t.hls) { t.hls.destroy(); t.hls = null; } tileNative(i, url); return; }
      if (t.mode === 'native' && hlsJsSupported()) { tileHls(i, url); return; }
    }
    clearTimeout(t.timer);
    t.el.classList.remove('loading');
    var err = t.el.querySelector('.tile-err');
    err.textContent = msg;
    if (t.ch && !/riprodurre un altro video/.test(msg)) setDead(t.ch.url, true); // limite della TV, non colpa del canale
    err.classList.remove('hidden');
  }

  function tileNative(i, url) {
    var t = state.multi.tiles[i];
    t.mode = 'native';
    t.video.src = url;
    var p = t.video.play(); if (p && p.catch) p.catch(function () {});
  }

  function tileHls(i, url) {
    var t = state.multi.tiles[i];
    var Hls = window.Hls;
    t.mode = 'hlsjs';
    // Riquadri piccoli: qualità limitata alla dimensione del riquadro e buffer ridotto (meno memoria e rete).
    // liveMaxLatency/maxLiveSyncPlaybackRate: se il riquadro resta indietro, hls.js lo riporta in diretta da solo.
    var hls = new Hls({ capLevelToPlayerSize: true, startLevel: 0, maxBufferLength: 12, maxMaxBufferLength: 20,
      liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 7, maxLiveSyncPlaybackRate: 1.15,
      backBufferLength: 0, maxBufferSize: 20 * 1000 * 1000, manifestLoadingMaxRetry: 1, fragLoadingMaxRetry: 2 });
    t.hls = hls;
    hls.on(Hls.Events.ERROR, function (ev, d) {
      if (d.fatal && t.hls === hls) tileFail(i, d.details === 'manifestLoadError' ? 'Canale non raggiungibile' : 'Errore di riproduzione');
    });
    hls.on(Hls.Events.MANIFEST_PARSED, function () { var p = t.video.play(); if (p && p.catch) p.catch(function () {}); });
    hls.loadSource(url);
    hls.attachMedia(t.video);
  }

  function tileLoad(i, ch) {
    var m = state.multi;
    var t = m.tiles[i];
    tileStop(i);
    t.ch = ch; t.fallback = false;
    t.el.classList.remove('empty');
    t.el.classList.add('loading');
    t.el.querySelector('.tile-err').classList.add('hidden');
    t.el.querySelector('.tl-num').textContent = ch.num;
    t.el.querySelector('.tl-name').textContent = ch.title;
    fillTileEpg(t);
    showTileLabel(i);
    t.el.classList.remove('standby');
    if (state.multiSingle && i !== m.focus) { tileStandby(i); updateTileAudio(); return; }
    if (!t.video._wired) {
      t.video._wired = true;
      t.video.addEventListener('playing', function () { clearTimeout(t.timer); t.el.classList.remove('loading'); t.played = true; });
      t.video.addEventListener('error', function () { if (t.mode === 'native' && t.video.getAttribute('src')) tileFail(+t.el.getAttribute('data-i'), 'Formato non supportato o canale offline'); });
    }
    if (/\.m3u8?(\?|$)|\/hls\/|m3u8/i.test(ch.url) && hlsJsSupported()) tileHls(i, ch.url);
    else tileNative(i, ch.url);
    t.timer = setTimeout(function () {
      tileFail(i, i > 0 && (platform === 'tizen' || platform === 'webos') ?
        'La TV non riesce a riprodurre un altro video insieme' : 'Il canale non risponde');
    }, STREAM_TIMEOUT);
    updateTileAudio();
  }

  // Come playerWatchdog, per ogni riquadro della multivisione.
  function tileWatchdog() {
    if (state.multiSingle && ++state.multi.shotTick % 5 === 0) {
      state.multi.tiles.forEach(function (t) { if (t.ch && !t.el.classList.contains('standby') && !t.video.paused) tileSnapshot(t); });
    }
    if (!state.multiSingle && (platform === 'webos' || platform === 'tizen')) {
      var now = Date.now(), moving = 0, stuck = 0;
      state.multi.tiles.forEach(function (t) {
        if (!t.ch || !t.played) return;
        if (t.video.currentTime !== t.dLast) { t.dLast = t.video.currentTime; t.dTime = now; moving++; }
        else if (now - (t.dTime || now) >= 4000) stuck++;
      });
      if (moving && stuck) { enableSingleVideo(); return; }
    }
    state.multi.tiles.forEach(function (t, i) {
      var v = t.video;
      if (!t.ch || t.el.classList.contains('loading') || v.paused || v.seeking ||
          !t.el.querySelector('.tile-err').classList.contains('hidden')) { t.stallSec = 0; return; }
      if (t.retryUrl !== t.ch.url) { t.retryUrl = t.ch.url; t.retries = 0; }
      if (v.currentTime !== t.lastTime) { t.lastTime = v.currentTime; t.stallSec = 0; return; }
      if (++t.stallSec < STALL_SECONDS) return;
      t.stallSec = 0;
      if (t.retries < STALL_RETRIES) { t.retries++; tileLoad(i, t.ch); }
      else tileFail(i, 'Il canale continua a bloccarsi');
    });
  }

  function tileClear(i) {
    var t = state.multi.tiles[i];
    tileStop(i);
    t.ch = null;
    t.el.className = 'tile focusable empty' + (i === state.multi.focus ? ' focused' : '');
    t.el.querySelector('.tile-err').classList.add('hidden');
  }

  function fillTileEpg(t) {
    var nn = EPG.nowNext(t.ch && t.ch.epg);
    t.el.querySelector('.tl-now').textContent = nn.now ? hhmm(nn.now[0]) + '  ' + nn.now[2] : '';
  }

  // Audio solo dal riquadro selezionato.
  function updateTileAudio() {
    var m = state.multi; if (!m) return;
    m.tiles.forEach(function (t, i) {
      t.video.muted = i !== m.focus;
      t.el.classList.toggle('audio', i === m.focus && !!t.ch);
    });
  }

  function focusTile(i) {
    var m = state.multi;
    var prev = m.focus;
    m.focus = i;
    if (state.multiSingle && prev !== i) {
      clearTimeout(m.swapTimer);
      m.swapTimer = setTimeout(function () {
        if (state.multi !== m) return;
        m.tiles.forEach(function (t, j) { if (j !== m.focus && t.ch && !t.el.classList.contains('standby')) tileStandby(j); });
        var f = m.tiles[m.focus];
        if (f.ch && f.el.classList.contains('standby')) tileLoad(m.focus, f.ch);
      }, 450);
    }
    Nav.focus(m.tiles[i].el);
    updateTileAudio();
    showTileLabel(i);
  }

  // Il nome del canale compare solo per qualche secondo (quando ti muovi, premi OK o cambi canale).
  function showTileLabel(i, keep) {
    var m = state.multi; if (!m || !m.tiles[i]) return;
    var t = m.tiles[i];
    clearTimeout(t.labelTimer);
    t.el.classList.add('show-label');
    if (!keep) t.labelTimer = setTimeout(function () { t.el.classList.remove('show-label'); }, 3000);
  }

  function tileMenu(open) {
    var m = state.multi;
    var was = m.menu;
    m.tiles.forEach(function (t) { t.el.querySelector('.tile-menu').classList.add('hidden'); t.el.classList.remove('menu-open'); });
    m.menu = open ? m.focus : -1;
    if (open) m.tiles[m.focus].el.classList.add('menu-open');
    if (open) { m.menuSel = 0; m.tiles[m.focus].el.querySelector('.tile-menu').classList.remove('hidden'); highlightTileMenu(); showTileLabel(m.focus, true); }
    else if (was >= 0) showTileLabel(was);
  }

  // Ritardo di un riquadro rispetto alla diretta (0 se in diretta).
  function tileBehind(t) {
    var v = t.video;
    if (!t.ch || !v.seekable || !v.seekable.length) return 0;
    var end = v.seekable.end(v.seekable.length - 1);
    var ref = (t.hls && t.hls.liveSyncPosition) || (end - 20);
    var b = ref - v.currentTime;
    return b > LIVE_TOLERANCE ? b : 0;
  }

  function tileGoLive(i) {
    var t = state.multi.tiles[i];
    var v = t.video;
    if (v.seekable && v.seekable.length) {
      var end = v.seekable.end(v.seekable.length - 1);
      v.currentTime = (t.hls && t.hls.liveSyncPosition) || Math.max(v.seekable.start(0), end - 10);
    }
    var p = v.play(); if (p && p.catch) p.catch(function () {});
    t.el.querySelector('.tile-live').classList.add('hidden');
  }

  // Ogni secondo: badge "● Diretta" sui riquadri indietro; se non sono in pausa tornano in diretta da soli.
  function updateTileLive() {
    state.multi.tiles.forEach(function (t, i) {
      var b = tileBehind(t);
      var badge = t.el.querySelector('.tile-live');
      if (b > 15 && !t.video.paused) { tileGoLive(i); return; }
      setIc(badge, [[t.video.paused ? 'pause' : 'rewind', '−' + fmtDur(b)], ['live', 'Diretta']]);
      badge.classList.toggle('hidden', !b);
    });
  }

  function highlightTileMenu() {
    var m = state.multi;
    var btns = m.tiles[m.menu].el.querySelectorAll('.tbtn');
    Array.prototype.forEach.call(btns, function (b, j) { b.classList.toggle('focused', j === m.menuSel); });
  }

  function tileAct(act) {
    var m = state.multi;
    var i = m.focus, t = m.tiles[i];
    tileMenu(false);
    if (act === 'full' && t.ch) {
      var idx = state.channels.indexOf(t.ch);
      closeMulti(false);
      state.multiReturn = { tile: i };
      openPlayer(state.channels, idx < 0 ? 0 : idx);
    } else if (act === 'change') {
      openPicker(function (ch) { tileLoad(i, ch); });
    } else if (act === 'live') {
      tileGoLive(i);
    } else if (act === 'remove') {
      tileClear(i);
    }
  }

  function zapTile(step) {
    var m = state.multi, t = m.tiles[m.focus];
    var idx = t.ch ? state.channels.indexOf(t.ch) : -1;
    var n = state.channels.length;
    tileLoad(m.focus, state.channels[((idx + step) % n + n) % n]);
  }

  function multiAction(a) {
    var m = state.multi;
    if (m.menu >= 0) {
      var count = m.tiles[m.menu].el.querySelectorAll('.tbtn').length;
      if (a === 'left' || a === 'up') { m.menuSel = (m.menuSel - 1 + count) % count; highlightTileMenu(); return true; }
      if (a === 'right' || a === 'down') { m.menuSel = (m.menuSel + 1) % count; highlightTileMenu(); return true; }
      if (a === 'enter') { tileAct(m.tiles[m.menu].el.querySelectorAll('.tbtn')[m.menuSel].getAttribute('data-act')); return true; }
      if (a === 'back') { tileMenu(false); return true; }
      return true;
    }
    var t = m.tiles[m.focus];
    var cur = Nav.current();
    switch (a) {
      case 'up': case 'down': case 'left': case 'right':
        if (Nav.move(a)) {
          cur = Nav.current();
          if (cur.classList.contains('tile')) focusTile(+cur.getAttribute('data-i'));
        }
        return true;
      case 'enter':
        if (cur && cur.classList.contains('mlayout')) { setMultiLayout(+cur.getAttribute('data-n')); return true; }
        if (t.ch) tileMenu(true);
        else openPicker(function (ch) { tileLoad(m.focus, ch); });
        return true;
      case 'chup': case 'ff': zapTile(1); return true;
      case 'chdown': case 'rw': zapTile(-1); return true;
      case 'fav': if (t.ch) toggleFav(t.ch); return true;
      case 'guide':
        if (t.ch) openGuide(state.channels, Math.max(0, state.channels.indexOf(t.ch)));
        return true;
      case 'playpause':
        if (t.ch) { if (t.video.paused) t.video.play(); else t.video.pause(); }
        return true;
      case 'back': closeMulti(); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- Scelta canale (multivisione e lista sopra il video)
  // Senza "fixedList": preferiti in alto e poi tutti. Con "fixedList": quella lista, già posizionata su "selIdx".
  // ---------------------------------------------------------------- Aggiunta playlist / guide
  // Usate sia dai campi in Impostazioni sia dall'invio dal telefono. Un indirizzo già presente viene solo riattivato.
  function addPlaylistUrl(name, url) {
    var p = null;
    state.playlists.forEach(function (x) { if (x.url === url) p = x; });
    if (!p) {
      p = { id: 'u' + Date.now(), name: name || 'Playlist personale', url: url, preset: false };
      state.playlists.push(p);
      saveCustomPlaylists();
    }
    state.activeId = p.id; Store.set('activePlaylist', p.id);
    state.group = '__all';
    loadActive();
    renderPlaylists();
    return p;
  }

  function addEpgUrl(name, url) {
    var exists = state.epgSources.some(function (x) { return x.url === url; });
    if (!exists) state.epgSources.push({ id: 'e' + Date.now(), name: name || 'Guida personale', url: url, preset: false, on: true });
    saveEpgSources();
    renderEpgSources();
    loadEpg(true);
  }

  // ---------------------------------------------------------------- Invia dal telefono o dal PC
  // La TV mostra un codice nuovo a ogni apertura; telefono/PC cifrano con quel codice (js/pair.js) e inviano
  // tramite ntfy.sh. La TV ascolta il canale derivato dal codice e accetta solo messaggi che sa decifrare.
  function openPair() {
    if (!window.Pair || !window.qrcode) { toast('Funzione non disponibile su questo dispositivo'); return; }
    closePair();
    var code = Pair.newCode();
    var p = state.pair = { code: code, keys: null, since: Math.floor(Date.now() / 1000) - 10, last: '', seen: {}, es: null, timer: null };
    el.pair.querySelector('.pair-code').textContent = Pair.formatCode(code);
    el.pair.querySelector('.pair-url').textContent = SEND_URL.replace(/^https:\/\//, '').replace(/\/$/, '');
    el.pair.querySelector('.pair-log').innerHTML = '';
    el.pair.querySelector('.pair-qr').innerHTML = '';
    pairStatus('Preparo il codice…');
    el.pair.classList.remove('hidden');
    setTimeout(function () {       // lascia comparire il riquadro prima dei calcoli (sulle TV lente si nota)
      if (state.pair !== p) return;
      try {
        var q = qrcode(0, 'M');
        q.addData(SEND_URL + '#c=' + code);
        q.make();
        var img = document.createElement('img');
        img.src = q.createDataURL(8, 4);
        img.alt = 'Codice QR';
        el.pair.querySelector('.pair-qr').appendChild(img);
      } catch (e) { /* senza QR resta il codice da scrivere */ }
      p.keys = Pair.keys(code);
      pairStatus('In attesa di quello che invii dal telefono o dal PC…');
      pairListen(p);
    }, 60);
    p.expire = setTimeout(function () {
      if (state.pair === p) { closePair(); toast('Codice scaduto: riapri "Aggiungi dal telefono" se ti serve'); }
    }, PAIR_MINUTES * 60e3);
  }

  function closePair() {
    var p = state.pair;
    if (!p) return;
    state.pair = null;
    clearTimeout(p.timer); clearTimeout(p.expire);
    if (p.es) { try { p.es.close(); } catch (e) { /* ignora */ } }
    el.pair.classList.add('hidden');
  }

  function pairStatus(t) { el.pair.querySelector('.pair-status').textContent = t; }

  // Ascolto: EventSource (una sola connessione) se c'è, altrimenti interrogazione ogni 6 secondi.
  function pairListen(p) {
    var base = Pair.RELAY + p.keys.topic;
    if (window.EventSource && platform !== 'android') {
      try {
        p.es = new EventSource(base + '/sse?since=' + p.since);
        p.es.onmessage = function (ev) { if (state.pair === p) pairMessage(p, ev.data); };
        p.es.onerror = function () {
          if (state.pair !== p || !p.es) return;
          try { p.es.close(); } catch (e) { /* ignora */ }
          p.es = null;
          pairPoll(p);
        };
        return;
      } catch (e) { p.es = null; }
    }
    pairPoll(p);
  }

  function pairPoll(p) {
    if (state.pair !== p) return;
    httpGet(Pair.RELAY + p.keys.topic + '/json?poll=1&since=' + (p.last || p.since)).then(function (txt) {
      String(txt || '').split('\n').forEach(function (line) { if (line && state.pair === p) pairMessage(p, line); });
    }, function () {
      if (state.pair === p) pairStatus('Non riesco a raggiungere il servizio di invio: controlla la connessione. Riprovo…');
    }).then(function () {
      if (state.pair === p) p.timer = setTimeout(function () { pairPoll(p); }, 6000);
    });
  }

  function pairMessage(p, raw) {
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || m.event !== 'message' || typeof m.message !== 'string') return;
    if (m.id) { if (p.seen[m.id]) return; p.seen[m.id] = 1; p.last = m.id; }
    var d = Pair.decrypt(p.keys, m.message);
    if (!d) return;                                                     // non è per noi o è stato alterato
    if (d.t !== 'xt' && (typeof d.url !== 'string' || d.url.length > 2000 || !/^https?:\/\/\S+$/i.test(d.url))) return;
    var name = String(d.name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 60);
    var line = document.createElement('div');
    line.className = 'pair-item';
    if (d.t === 'epg') {
      addEpgUrl(name, d.url);
      setIc(line, 'check', 'Guida TV aggiunta: ' + (name || maskUrl(d.url)));
    } else if (d.t === 'xt') {
      var xp = typeof d.user === 'string' && typeof d.pass === 'string' ? addXtream(d.server, d.user.slice(0, 200), d.pass.slice(0, 200), name) : null;
      if (!xp) return;
      setIc(line, 'check', 'Account aggiunto e attivato: ' + xp.name);
    } else if (d.t === 'pl') {
      var pl = addPlaylistUrl(name, d.url);
      setIc(line, 'check', 'Playlist aggiunta e attivata: ' + pl.name);
    } else return;
    el.pair.querySelector('.pair-log').appendChild(line);
    pairStatus('Ricevuto! Puoi inviare altro con lo stesso codice, oppure premi Indietro.');
  }

  function openPicker(onPick, fixedList, selIdx, title) {
    var favs = fixedList ? [] : state.channels.filter(function (c) { return state.favorites[c.url]; });
    var rest = fixedList || state.channels.filter(function (c) { return !state.favorites[c.url]; });
    var list = favs.concat(rest).slice(0, 3000);
    state.picker = { list: list, sel: 0, onPick: onPick, favCount: favs.length };
    el.picker.querySelector('.guide-ch').textContent = title || 'Scegli un canale';
    var box = el.pickerList;
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    list.forEach(function (ch, i) {
      if (i === 0 && favs.length) frag.appendChild(pickerHeader('Preferiti', 'starf'));
      if (i === favs.length && favs.length) frag.appendChild(pickerHeader('Tutti i canali'));
      var r = document.createElement('div');
      r.className = 'pk-row' + (state.dead[ch.url] ? ' dead' : '');
      r.setAttribute('data-i', i);
      var num = document.createElement('span'); num.className = 'pk-num'; num.textContent = ch.num;
      var nm = document.createElement('span'); nm.className = 'pk-name'; nm.textContent = ch.title;
      var nn = EPG.nowNext(ch.epg);
      var now = document.createElement('span'); now.className = 'pk-now'; now.textContent = nn.now ? nn.now[2] : '';
      r.appendChild(num); r.appendChild(nm); r.appendChild(now);
      frag.appendChild(r);
    });
    box.appendChild(frag);
    el.picker.classList.remove('hidden');
    pickerSelect(selIdx > 0 && selIdx < list.length ? selIdx : 0);
  }

  // Lista canali sopra il video: scegli senza uscire da quello che stai guardando.
  function openChannelList() {
    if (!state.playList.length) return;
    hideOsd();
    openPicker(function (ch) {
      var i = state.playList.indexOf(ch);
      if (i >= 0 && i !== state.playIdx) playIndex(i);
    }, state.playList, state.playIdx, 'Canali');
  }

  // Torna al canale visto prima (comodo per alternare tra due canali).
  function prevChannel() {
    if (!state.prevUrl) { toast('Nessun canale precedente'); return; }
    var i = -1, k;
    for (k = 0; k < state.playList.length; k++) if (state.playList[k].url === state.prevUrl) { i = k; break; }
    if (i < 0) {
      for (k = 0; k < state.channels.length; k++) if (state.channels[k].url === state.prevUrl) { i = k; break; }
      if (i < 0) { toast('Il canale precedente non è più nella playlist'); return; }
      state.playList = state.channels.slice();
    }
    playIndex(i);
  }

  function pickerHeader(txt, icon) {
    var h = document.createElement('div'); h.className = 'guide-day';
    if (icon) setIc(h, icon, txt); else h.textContent = txt;
    return h;
  }

  function pickerSelect(i) {
    var p = state.picker;
    var prev = el.pickerList.querySelector('.pk-row.sel');
    if (prev) prev.classList.remove('sel');
    p.sel = Math.max(0, Math.min(i, p.list.length - 1));
    var row = el.pickerList.querySelector('.pk-row[data-i="' + p.sel + '"]');
    if (row) { row.classList.add('sel'); if (row.scrollIntoViewIfNeeded) row.scrollIntoViewIfNeeded(false); else row.scrollIntoView({ block: 'nearest' }); }
  }

  function closePicker() { state.picker = null; el.picker.classList.add('hidden'); }

  function pickerAction(a) {
    var p = state.picker;
    switch (a) {
      case 'up': pickerSelect(p.sel - 1); return true;
      case 'down': pickerSelect(p.sel + 1); return true;
      case 'left': case 'chup': pickerSelect(p.sel - 10); return true;
      case 'right': case 'chdown': pickerSelect(p.sel + 10); return true;
      case 'enter': var ch = p.list[p.sel], cb = p.onPick; closePicker(); cb(ch); return true;
      case 'back': closePicker(); return true;
    }
    return true;
  }

  // ---------------------------------------------------------------- Azioni
  var actions = {
    openMulti: function () { openMulti(null); },
    openMultiPlaying: function () {
      if (state.multiReturn) returnToMulti();
      else openMulti(state.playing);
    },
    cycleMultiPref: function () {
      var opts = [0, 2, 4];
      state.multiPref = opts[(opts.indexOf(state.multiPref) + 1) % opts.length];
      Store.set('multiPref', state.multiPref);
      updateMultiPrefLabel();
      if (state.multiPref === 4 && deviceTiles() < 4) toast('Attenzione: questo dispositivo potrebbe non reggere 4 canali insieme', 4000);
      else toast('Multivisione: ' + (state.multiPref ? state.multiPref + ' riquadri' : 'automatica (' + deviceTiles() + ')'));
    },
    openSettings: openSettings,
    closeSettings: closeSettings,
    closePlayer: function () { closePlayer(); },
    prevChannel: function () { prevChannel(); showOsd(true); },
    openChannelList: function () { openChannelList(); },
    cycleAudio: function () { cycleAudio(); showOsd(true); },
    cycleSubs: function () { cycleSubs(); showOsd(true); },
    toggleResume: function () {
      state.resumeLast = !state.resumeLast; Store.set('resumeLast', state.resumeLast); updateOptLabels();
    },
    toggleHideDead: function () {
      state.hideDead = !state.hideDead; Store.set('hideDead', state.hideDead); updateOptLabels(); applyFilter();
    },
    clearDead: function () {
      state.dead = {}; Store.set('dead', {}); applyFilter(); toast('Tutti i canali verranno riprovati');
    },
    toggleFavPlaying: function () { toggleFav(state.playing); showOsd(true); },
    seekBack: function () { seekBy(-SEEK_STEP); showOsd(true); },
    seekFwd: function () { seekBy(SEEK_STEP); showOsd(true); },
    togglePause: function () { togglePause(); showOsd(true); },
    goLive: function () { goLive(); showOsd(true); },
    cycleQuality: function () { cycleQuality(); showOsd(true); },
    openGuidePlaying: function () { openGuide(state.playList, state.playIdx); },
    usePlaylist: function (b) {
      state.activeId = b.getAttribute('data-id');
      Store.set('activePlaylist', state.activeId);
      state.group = '__all'; state.query = ''; el.search.value = '';
      loadActive();
      renderPlaylists();
      Nav.setRoot(el.screens.settings, el.plList.querySelector('.pl-row.current .btn'));
      toast('Playlist attiva: ' + activePlaylist().name);
    },
    deletePlaylist: function (b) {
      var id = b.getAttribute('data-id');
      state.playlists = state.playlists.filter(function (p) { return p.id !== id; });
      saveCustomPlaylists();
      Store.remove('cache:' + id);
      Store.remove('epg:' + id);
      if (state.activeId === id) { state.activeId = state.playlists.length ? state.playlists[0].id : ''; Store.set('activePlaylist', state.activeId); loadActive(); }
      renderPlaylists();
      Nav.setRoot(el.screens.settings, null);
      toast('Playlist eliminata');
    },
    openPair: function () { openPair(); },
    openLogin: function () { openSettings(); Nav.setRoot(el.screens.settings, $('xt-server')); $('xt-server').scrollIntoView(); },
    addXtream: function () {
      var p = addXtream($('xt-server').value, $('xt-user').value.trim(), $('xt-pass').value, '');
      if (!p) return;
      $('xt-pass').value = '';
      Nav.setRoot(el.screens.settings, el.plList.querySelector('.pl-row.current .btn'));
      toast('Account aggiunto e attivato: carico i canali…');
    },
    closePair: function () { closePair(); },
    addPlaylist: function () {
      var url = el.plUrlIn.value.trim();
      var name = el.plNameIn.value.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { toast('Inserisci un URL valido che inizi con http:// o https://'); return; }
      addPlaylistUrl(name, url);
      el.plUrlIn.value = ''; el.plNameIn.value = '';
      Nav.setRoot(el.screens.settings, el.plList.querySelector('.pl-row.current .btn'));
      toast('Playlist aggiunta e attivata');
    },
    reload: function () { loadActive(); toast('Ricarico la playlist…'); },
    clearFavs: function () {
      state.favorites = {}; Store.set('favorites', {});
      renderGroups(); if (state.group === '__fav') applyFilter();
      toast('Preferiti svuotati');
    },
    toggleEpg: function () {
      state.epgEnabled = !state.epgEnabled;
      Store.set('epgEnabled', state.epgEnabled);
      epgChanged('#epg-toggle');
    },
    refreshEpg: function () { loadEpg(true); toast('Aggiorno la guida TV…'); renderEpgSources(); },
    toggleEpgSource: function (b) {
      var id = b.getAttribute('data-id');
      state.epgSources.forEach(function (s) { if (s.id === id) s.on = s.on === false; });
      epgChanged('[data-action="toggleEpgSource"][data-id="' + id + '"]');
    },
    deleteEpgSource: function (b) {
      var id = b.getAttribute('data-id');
      state.epgSources = state.epgSources.filter(function (s) { return s.id !== id; });
      epgChanged(null);
      toast('Guida eliminata');
    },
    addEpg: function () {
      var url = el.epgUrlIn.value.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { toast('Inserisci un URL valido (XMLTV .xml o .xml.gz)'); return; }
      addEpgUrl('', url);
      el.epgUrlIn.value = '';
      Nav.setRoot(el.screens.settings, el.screens.settings.querySelector('#epg-toggle'));
      toast('Guida aggiunta: la scarico…');
    }
  };

  function activate(target) {
    if (!target) return;
    if (target.tagName === 'INPUT') { target.focus(); return; }
    if (target.classList.contains('card')) { openPlayer(state.filtered, +target.getAttribute('data-idx')); return; }
    if (target.classList.contains('group')) {
      clearTimeout(state.timers.group);
      selectGroup(target.getAttribute('data-group'));
      if (el.grid.children[0]) Nav.focus(el.grid.children[0]);
      return;
    }
    var a = target.getAttribute('data-action');
    if (a && actions[a]) actions[a](target);
  }

  function keyToAction(k) {
    if (k >= 48 && k <= 57) return 'digit' + (k - 48);
    if (k >= 96 && k <= 105) return 'digit' + (k - 96);
    for (var name in KEYS) if (KEYS[name].indexOf(k) >= 0) return name;
    return null;
  }

  function handleBack() {
    // Indietro esce SEMPRE dal lettore (anche con la barra info aperta).
    if (state.screen === 'player') { closePlayer(); return; }
    if (state.screen === 'settings') { closeSettings(); return; }
    // browse
    var c = Nav.current();
    if (state.query) { state.query = ''; el.search.value = ''; applyFilter(); return; }
    if (c && c.classList.contains('card')) { Nav.focus(activeGroupEl()); return; }
    var now = Date.now();
    if (now - state.lastBack < 2500) { exitApp(); return; }
    state.lastBack = now;
    toast('Premi di nuovo Indietro per uscire');
  }

  function handleAction(a) {
    if (!a) return false;
    if (state.pair) { if (a === 'back' || a === 'enter') closePair(); return true; }
    if (state.picker && a.indexOf('digit') !== 0) return pickerAction(a); // i numeri restano "vai al canale N"
    if (state.guide) { if (guideAction(a)) return true; }
    if (state.screen === 'multi' && a.indexOf('digit') !== 0) return multiAction(a);
    if (a === 'back') { handleBack(); return true; }
    if (a.indexOf('digit') === 0) { if (state.screen !== 'settings') { typeDigit(a.slice(5)); return true; } return false; }

    if (state.screen === 'player') {
      switch (a) {
        case 'up': case 'chup': playIndex(state.playIdx + 1); return true;
        case 'down': case 'chdown': playIndex(state.playIdx - 1); return true;
        case 'rw': seekBy(-SEEK_STEP); return true;
        case 'ff': seekBy(SEEK_STEP); return true;
        case 'left': case 'right':
          // Barra visibile: muovi tra i pulsanti. Barra nascosta: la apre sul pulsante ⏪/⏩
          // (prima tornava subito indietro di 30 s ed era facile farlo per sbaglio).
          if (osdVisible() && Nav.current() && el.osd.contains(Nav.current())) { Nav.move(a); showOsd(true); }
          else { showOsd(false); Nav.setRoot(el.osd, el.osd.querySelector(a === 'left' ? '[data-action="seekBack"]' : '[data-action="seekFwd"]')); showOsd(true); }
          return true;
        case 'live': goLive(); return true;
        case 'enter':
          if (osdVisible() && Nav.current() && el.osd.contains(Nav.current())) activate(Nav.current());
          else if (behindLive()) { showOsd(false); Nav.setRoot(el.osd, el.osdLive); showOsd(true); } // OK → pronto su "Diretta"
          else showOsd(true);
          return true;
        case 'guide': openGuide(state.playList, state.playIdx); return true;
        case 'menu': case 'list': openChannelList(); return true;
        case 'prevch': prevChannel(); return true;
        case 'fav': toggleFav(state.playing); return true;
        case 'playpause': togglePause(); return true;
      }
      return false;
    }

    switch (a) {
      case 'up': case 'down': case 'left': case 'right':
        Nav.move(a); onFocusChange(); return true;
      case 'enter': activate(Nav.current()); return true;
      case 'fav': case 'menu':
        if (state.screen === 'browse') {
          var c = Nav.current();
          if (c && c.classList.contains('card')) { toggleFav(state.filtered[+c.getAttribute('data-idx')]); return true; }
        }
        return false;
      case 'guide': case 'playpause':
        // Elenco: Info / Verde / Play-Pausa aprono la guida del canale selezionato.
        if (state.screen === 'browse') {
          var cur = Nav.current();
          if (cur && cur.classList.contains('card')) { openGuide(state.filtered, +cur.getAttribute('data-idx')); return true; }
        }
        return false;
      case 'chup': case 'chdown':
        if (state.screen === 'browse') { for (var i = 0; i < 3; i++) Nav.move(a === 'chup' ? 'up' : 'down'); return true; }
        return false;
    }
    return false;
  }

  // ---------------------------------------------------------------- Eventi
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') {
      // Modalità scrittura: OK/Fine/Indietro/▲▼ chiudono la tastiera.
      if (k === 13 || k === 65376 || k === 65385 || k === 10009 || k === 461 || k === 27 || k === 38 || k === 40) {
        e.preventDefault();
        ae.blur();
        if (k === 38 || k === 40) { Nav.move(k === 38 ? 'up' : 'down'); onFocusChange(); }
      }
      return;
    }
    if (handleAction(keyToAction(k))) e.preventDefault();
  });

  var searchTimer = null;
  el.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = el.search.value.trim();
      applyFilter();
    }, 300);
  });

  // Supporto mouse / touch (browser, telecomandi "puntatore" LG Magic Remote).
  document.addEventListener('click', function (e) {
    var cl = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
    if (state.pair) {
      if (cl('[data-action="closePair"]') || !el.pair.querySelector('.pair-box').contains(e.target)) closePair();
      return;
    }
    if (state.picker) {
      var pr = cl('.pk-row');
      if (pr) { pickerSelect(+pr.getAttribute('data-i')); pickerAction('enter'); }
      else if (!el.picker.contains(e.target) || cl('[data-action="pickerClose"]')) closePicker();
      return;
    }
    if (state.screen === 'multi' && state.multi && !state.guide) {
      var lb = cl('.mlayout');
      if (lb) { setMultiLayout(+lb.getAttribute('data-n')); return; }
      var tile = cl('.tile');
      if (!tile) return;
      var ti = +tile.getAttribute('data-i');
      var tb = cl('.tbtn');
      if (tb) { tileAct(tb.getAttribute('data-act')); return; }
      if (cl('.tile-live')) { tileGoLive(ti); return; }
      if (ti !== state.multi.focus) { tileMenu(false); focusTile(ti); return; }  // 1° clic: seleziona (audio)
      multiAction('enter');                                                      // 2° clic: opzioni / aggiungi
      return;
    }
    if (state.guide) {
      if (!el.guide.contains(e.target)) { closeGuide(); return; }
      var row = e.target.closest ? e.target.closest('.gi') : null;
      if (row) guideSelect(+row.getAttribute('data-i'));
      if (e.target.closest && e.target.closest('[data-action="guideWatch"]')) guideAction('enter');
      if (e.target.closest && e.target.closest('[data-action="guideClose"]')) guideAction('back');
      return;
    }
    var t = e.target.closest ? e.target.closest('.focusable') : null;
    if (state.screen === 'player' && !t) { if (osdVisible()) hideOsd(); else showOsd(true); return; }
    if (!t) return;
    Nav.focus(t);
    activate(t);
  });
  el.grid.addEventListener('scroll', function () {
    if (el.grid.scrollTop + el.grid.clientHeight > el.grid.scrollHeight - 600 && state.rendered < state.filtered.length) renderMore();
  });
  ['pause', 'play', 'seeked'].forEach(function (ev) {
    el.video.addEventListener(ev, function () { if (osdVisible()) updateShift(); });
  });

  // ---------------------------------------------------------------- Avvio
  Icons.hydrate();
  Nav.setCustom(customNav);
  registerTvKeys();
  document.body.classList.add('platform-' + platform);
  window.BTV = { state: state };                                     // utile per il debug dalla console
  setInterval(refreshEpgViews, 60000);                                    // "in onda" aggiornato ogni minuto
  setInterval(function () {
    if (state.screen === 'player') { if (osdVisible()) updateShift(); updateLiveBadge(); playerWatchdog(); }
    else el.liveBadge.classList.add('hidden');
    if (state.screen === 'multi' && state.multi) { updateTileLive(); if (!background) tileWatchdog(); }
  }, 1000);
  show('browse', el.search);
  loadActive();
})();

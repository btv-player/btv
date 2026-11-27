/* BTV — logica principale. JavaScript compatibile con TV del 2017+ (niente async/await, niente moduli). */
(function () {
  'use strict';

  // ---------------------------------------------------------------- Config
  var APP_VERSION = '1.12.4'; // aumentala a ogni aggiornamento: in Impostazioni vedi quale versione sta girando
  var PRESETS = [];      // nessuna lista precaricata: solo quelle che aggiungi tu
  // Guide TV gratuite in formato XMLTV (si possono disattivare o aggiungerne altre nelle Impostazioni).
  var DEFAULT_EPG = [];  // nessuna guida precaricata: quella della playlist + quelle che aggiungi tu
  var EPG_MAX_AGE = 6 * 3600e3; // ogni quanto riscaricare la guida
  // ---------------------------------------------------------------- Livello di prestazioni
  // 0 = Leggero, 1 = Normale, 2 = Completo. Deciso dal dispositivo (memoria, processori, fluidità misurata),
  // non dalla marca, e sempre PRUDENTE: nel dubbio un livello sotto. Si sale al massimo di un livello per avvio,
  // solo se l'avvio precedente è andato liscio; se durante l'uso compaiono scatti, al prossimo avvio si scende.
  // Si può forzare in Impostazioni → Prestazioni. Le soglie sono provvisorie: da regolare con i numeri della Diagnostica.
  var PERF = (function () {
    var plat = detectPlatform();
    var mem = +navigator.deviceMemory || 0, cores = +navigator.hardwareConcurrency || 0;
    var saved = Store.get('perf', null) || {};
    var mode = Store.get('perfMode', 'auto');
    // Livello massimo che le caratteristiche permettono (soglie prudenti).
    var spec;
    if (plat === 'web') spec = 2;                                   // PC di sviluppo
    else if (mem >= 2 && cores >= 4) spec = 2;                      // es. Fire TV Stick 4K (2 GB, 4 core)
    else if (mem >= 2) spec = 1;
    else if (!mem && cores >= 4 && plat === 'android') spec = 1;    // memoria non dichiarata: al massimo Normale
    else spec = 0;                                                  // 1 GB o meno, oppure TV senza dati certi
    if (saved.janky) spec = Math.max(0, spec - 1);                  // la prova di fluidità ha visto scatti
    if (typeof saved.cap === 'number') spec = Math.min(spec, saved.cap);   // scatti visti in passato: tetto fisso
    var tier;
    if (plat === 'web') tier = 2;
    else if (saved.tier === undefined) tier = 0;                    // primo avvio: si parte dal più leggero
    else if (saved.slow) tier = Math.max(0, saved.tier - 1);        // scatti durante l'uso: un livello sotto
    else tier = Math.min(spec, saved.tier + 1);                     // altrimenti si sale di uno, fino al massimo
    var auto = tier;
    if (mode === '0' || mode === '1' || mode === '2') tier = +mode;
    var store = { tier: auto, spec: spec, janky: !!saved.janky };
    if (typeof saved.cap === 'number') store.cap = saved.cap;
    if (plat !== 'web') Store.set('perf', store);
    return { tier: tier, auto: auto, spec: spec, mode: mode, mem: mem, cores: cores, web: plat === 'web' };
  })();
  var PERF_NAMES = ['Leggero', 'Normale', 'Completo'];
  function byTier(a, b, c, web) { return PERF.web && web !== undefined ? web : [a, b, c][PERF.tier]; }

  // Effetti grafici pieni (ombre, transizioni) solo dal livello Completo.
  var LOW_POWER = PERF.tier < 2 && !PERF.web;
  var STREAM_TIMEOUT = 25000;  // ms prima di dichiarare un canale non disponibile
  var OSD_TIME = 5000;
  // "torna indietro"/pausa: 2 / 3 / 5 minuti (con 1 GB di memoria 5 minuti in FHD erano troppi), 10 sul PC
  var TIMESHIFT_SECONDS = byTier(120, 180, 300, 600);
  var BUFFER_BYTES = byTier(40, 60, 100, 150) * 1000 * 1000;
  var LIST_BUFFER = byTier(2, 3, 5);                // righe in più tenute nel DOM attorno a quelle visibili
  var EPG_FUTURE = byTier(14, 26, 26) * 3600e3;     // ore di guida futura tenute in memoria
  var LIVE_AHEAD = 30;                             // secondi scaricati in anticipo mentre si guarda
  var DEAD_TTL = 12 * 3600e3;  // un canale che non va resta segnato per 12 ore (poi si riprova)
  var SEEK_STEP = 30;          // secondi per ogni pressione di ◀ / ▶ / ⏪ / ⏩
  var LIVE_TOLERANCE = 6;      // entro questi secondi dalla diretta si è "in diretta"
  var AUTO_LIVE_LAG = 20;      // ritardo non voluto oltre il quale si torna da soli in diretta
  var STALL_SECONDS = 15;      // video fermo da così tanti secondi = bloccato: riavvio automatico
  var STALL_RETRIES = 3;
  var SEND_URL = 'https://btv-player.github.io/btv/invia/'; // pagina per inviare playlist/guide dal telefono o PC
  var PAIR_MINUTES = 15;
  var VERSION_URL = 'https://btv-player.github.io/btv/version.json'; // solo lettura: numero dell'ultima versione
  var UPDATE_PREFIX = 'https://github.com/btv-player/btv/releases/download/';
  var WEB_PREFIX = 'https://btv-player.github.io/btv/web/';           // aggiornamenti firmati per LG / Samsung
  var MAX_DOWNLOAD = 60 * 1024 * 1024;  // playlist o guida scaricata: oltre è un errore (protegge la memoria della TV)          // validità del codice mostrato sulla TV       // riavvii automatici di fila prima di mostrare l'errore

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
  // Va calcolato dopo platform (prima era sopra e risultava sempre falso: la TV diceva "si installa dal PC").
  var TV_SELF_UPDATE = (platform === 'webos' || platform === 'tizen') && !!window.BTV_VERIFY;
  // BTV funziona solo come app installata su TV e Fire TV: nessun accesso da browser o telefono
  // (il browser resta solo per lo sviluppo, su questo PC).
  if (platform === 'web' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    document.body.innerHTML = '<p style="color:#c9d3f5;font:20px sans-serif;text-align:center;margin-top:20vh">BTV è disponibile solo come app per Smart TV e Fire TV.</p>';
    return;
  }
  var state = {
    channels: [], groups: [], group: '__home', query: '', pv: { ch: null, hls: null, timer: null },
    filtered: [],
    favorites: Store.get('favorites', {}),
    playlists: loadPlaylists(),
    activeId: Store.get('activePlaylist', ''),
    screen: 'browse',
    playList: [], playIdx: -1, playing: null,
    hls: null, mode: null, loader: null, zapTarget: null,
    timers: {}, numBuf: '', lastBack: 0, returnFocus: null, loadToken: 0,
    epgEnabled: Store.get('epgEnabled', true),
    epgSources: loadEpgSources(),
    playlistEpg: [], epgToken: 0, epgCount: 0, epgLoading: false,
    guide: null, pair: null, watchTick: 0, favOrder: Store.get('favOrder', []), reorder: null, update: null, updLast: 0, updCheck: Store.get('updCheck', true), multiSingle: Store.get('multiSingle', false),
    quality: Store.get('quality', 0), levels: [],
    multiPref: Store.get('multiPref', 0), multi: null, multiReturn: null, multiBrowseFocus: null, picker: null,
    resumeLast: Store.get('resumeLast', true), resumed: false, prevUrl: null,
    hideDead: Store.get('hideDead', false), dead: loadDead()
  };

  // Diagnostica: tempi delle operazioni principali (avvio, playlist, guida, cambio canale) e memoria,
  // visibili in Impostazioni → Diagnostica. Solo su questo dispositivo, niente viene inviato.
  var Diag = {
    start: Date.now(),
    items: [],
    time: function (label, ms) {
      Diag.items.push({ at: Date.now(), label: label, ms: Math.round(ms) });
      if (Diag.items.length > 40) Diag.items.shift();
      if (window.console && console.log) console.log('[BTV] ' + label + ': ' + Math.round(ms) + ' ms');
    },
    since: function (label, t0) { Diag.time(label, Date.now() - t0); }
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
    toast: $('toast'), pair: $('pair'), home: $('home'), pvPanel: $('h-preview'), pvVideo: $('pv-video'), hgList: $('hg-list'),
    clock: $('clock'), updBtn: $('btn-update'), optUpd: $('opt-update')
  };

  // Elenchi lunghi "a finestra" (vlist.js): nel DOM solo le righe vicine a quelle visibili.
  var gridV = new VList(el.grid, { count: function () { return state.filtered.length; },
    make: function (i) { return makeCard(state.filtered[i], i); }, cols: 'auto', buffer: LIST_BUFFER });
  var hgV = new VList(el.hgList, { count: function () { return (state.hgAll || []).length; }, make: makeGuideRow, buffer: LIST_BUFFER + 2 });
  var pickV = new VList(el.pickerList, { count: function () { return state.picker ? state.picker.list.length : 0; },
    make: function (i) { return makePickerRow(i); }, buffer: LIST_BUFFER + 3 });

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
      previewStop();
      return;
    }
    if (state.screen === 'browse' && state.pv.ch && !el.home.classList.contains('hidden')) previewPlay(state.pv.ch);
    if (state.screen === 'player' && state.playing) { startStream(state.playing); showOsd(false); }
    else if (state.screen === 'multi' && state.multi) {
      state.multi.tiles.forEach(function (t, i) { if (t.ch) tileLoad(i, t.ch); });
    }
    keepScreenOn(state.screen === 'player' || state.screen === 'multi');
    // Fire TV tiene l'app aperta in sottofondo anche per giorni: al rientro si ricontrolla (se l'ultimo controllo
    // ha più di 2 minuti), qualunque sia la schermata; il riquadro compare poi nella Home.
    if (Date.now() - state.updLast > 2 * 60e3) checkUpdate(true);
  }
  document.addEventListener('visibilitychange', function () { setBackground(!!document.hidden); });
  // LG: BTV riaperta dalla barra delle app mentre era già in esecuzione.
  document.addEventListener('webOSRelaunch', function () {
    setBackground(false);
    if (Date.now() - state.updLast > 2 * 60e3) checkUpdate(true);
  });

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
    gridV.forEach(function (card, i) {
      var c = state.filtered[i];
      if (c && c.url === url) card.classList.toggle('dead', isDead);
    });
  }

  // Gli URL delle playlist personali spesso contengono utente e password: a schermo e nei log mostriamo solo il sito.
  function maskUrl(u) {
    var m = /^([a-z]+:\/\/)(?:[^@\/]*@)?([^\/?#]+)(.*)$/i.exec(String(u || ''));
    if (!m) return '…';
    return m[1] + m[2] + (m[3] && m[3] !== '/' ? '/…' : '');
  }

  // Indirizzi della rete di casa (router, NAS, telecamere...): li usa solo una playlist che sta anch'essa in casa
  // (es. un server IPTV locale). Così una playlist o una guida esterna non può far contattare i tuoi dispositivi.
  function isLocalUrl(u) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@\/?#]*@)?(\[[^\]]+\]|[^\/:?#]+)/i.exec(String(u || ''));
    if (!m) return false;
    var h = m[1].toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || /\.(local|lan|home|internal|localdomain|home\.arpa)$/.test(h)) return true;
    if (h.indexOf('.') < 0 && h.indexOf(':') < 0) return true;                 // nome senza dominio ("router")
    var ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (ip) {
      var a = +ip[1], b = +ip[2];
      return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    if (/^(0x[0-9a-f]*|\d+)$/i.test(h.split('.').pop())) return true;        // IP in forme strane (decimale, esadecimale): bloccati
    if (h.indexOf(':') >= 0) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || /^::ffff:/.test(h);
    return false;
  }
  function blockedLan(u) {
    if (!isLocalUrl(u)) return false;
    var pl = activePlaylist();
    return !(pl && isLocalUrl(pl.url));
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
    if (safeUrl(ch.logo) && !blockedLan(ch.logo)) {
      var img = new Image();
      img.alt = '';
      img.setAttribute('loading', 'lazy');
      img.decoding = 'async';                       // decodifica fuori dal disegno della pagina
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

  // Proxy disponibile solo con "npm run dev" (il browser applica CORS, le TV e Android no).
  function devProxy(url) {
    return platform === 'web' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/proxy?url=' + encodeURIComponent(url) : null;
  }

  // ---------------------------------------------------------------- Rete
  // Scaricamento con tempo limite. as: 'text' | 'bytes' | 'file' (solo Fire TV: indirizzo locale del file scaricato).
  // Su Fire TV si usa il download nativo su file (niente blocchi CORS, niente base64 tra Java e pagina, richieste
  // condizionali: con meta.etag / meta.lastModified un file non cambiato non si riscarica → notModified).
  var PLAYLIST_TIMEOUT = 90000, GUIDE_TIMEOUT = 180000, API_TIMEOUT = 30000;
  var dlSeq = 0;

  function nativeDl() {
    var S = platform === 'android' ? capPlugin('Screen') : null;
    return S && S.download ? S : null;
  }

  function withTimeout(p, ms, abort) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { if (abort) abort(); reject(new Error('tempo scaduto')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function download(url, opts) {
    opts = opts || {};
    var as = opts.as || 'text', timeout = opts.timeout || PLAYLIST_TIMEOUT, meta = opts.meta || {};
    var S = nativeDl();
    if (S) {
      return S.download({ url: url, name: opts.name || ('dl-' + (dlSeq++ % 4)), max: MAX_DOWNLOAD, timeout: timeout,
        etag: meta.etag || '', lastModified: meta.lastModified || '' }).then(function (r) {
        var info = { notModified: r.status === 304, meta: { etag: r.etag || '', lastModified: r.lastModified || '' }, size: r.size };
        var local = window.Capacitor.convertFileSrc('file://' + r.path);
        if (as === 'file') { info.fileUrl = local; return info; }
        return fetch(local).then(function (x) { return as === 'bytes' ? x.arrayBuffer() : x.text(); }).then(function (d) {
          if (as === 'bytes') info.bytes = new Uint8Array(d); else info.text = d;
          return info;
        });
      });
    }
    function direct(u) {
      var ctl = window.AbortController ? new AbortController() : null;
      var req = fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (+r.headers.get('content-length') > MAX_DOWNLOAD) throw new Error('file troppo grande');
        if (as === 'bytes' || as === 'file') {
          return r.arrayBuffer().then(function (b) {
            if (b.byteLength > MAX_DOWNLOAD) throw new Error('file troppo grande');
            return { bytes: new Uint8Array(b), meta: {} };
          });
        }
        return r.text().then(function (t) { if (t.length > MAX_DOWNLOAD) throw new Error('file troppo grande'); return { text: t, meta: {} }; });
      });
      return withTimeout(req, timeout, function () { if (ctl) ctl.abort(); });
    }
    return direct(url).catch(function (err) {
      var p = devProxy(url);
      if (!p) throw err;
      return direct(p);
    });
  }

  // Librerie usate di rado (QR, gzip senza Worker): caricate al primo uso invece che a ogni avvio.
  var libs = {};
  function loadLib(src) {
    if (!libs[src]) {
      libs[src] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { resolve(); };
        s.onerror = function () { libs[src] = null; reject(new Error('libreria non caricata')); };
        document.body.appendChild(s);
      });
    }
    return libs[src];
  }

  // Compatibilità: testo semplice (risposte piccole: API Xtream, "Invia dal telefono").
  function httpGet(url) { return download(url, { as: 'text', timeout: API_TIMEOUT }).then(function (r) { return r.text; }); }

  // Account Xtream: solo i canali in diretta (player_api), non l'intero catalogo m3u_plus con film e serie
  // (decine di migliaia di voci in più da scaricare, analizzare e tenere in memoria). Ritorna testo M3U.
  function xtreamParts(url) {
    var m = /^(https?:\/\/[^?#]+?)\/get\.php\?(.*)$/i.exec(url || '');
    if (!m) return null;
    var q = {};
    m[2].split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = kv.slice(i + 1); });
    if (!q.username || !q.password) return null;
    return { srv: m[1], user: q.username, pass: q.password, q: 'username=' + q.username + '&password=' + q.password };
  }

  function xtreamLive(x) {
    var api = x.srv + '/player_api.php?' + x.q + '&action=';
    return Promise.all([
      download(api + 'get_live_categories', { as: 'text', timeout: API_TIMEOUT, name: 'xt-cat' }),
      download(api + 'get_live_streams', { as: 'text', timeout: PLAYLIST_TIMEOUT, name: 'xt-live' })
    ]).then(function (r) {
      var cats = JSON.parse(r[0].text), streams = JSON.parse(r[1].text);
      if (!Array.isArray(streams) || !streams.length) throw new Error('nessun canale');
      var catName = {};
      (Array.isArray(cats) ? cats : []).forEach(function (c) { if (c) catName[String(c.category_id)] = String(c.category_name || ''); });
      function v(s) { return String(s == null ? '' : s).replace(/"/g, '\'').replace(/[\r\n]/g, ' '); }
      var out = ['#EXTM3U'];
      streams.forEach(function (s) {
        if (!s || s.stream_id == null) return;
        out.push('#EXTINF:-1 tvg-id="' + v(s.epg_channel_id) + '" tvg-logo="' + v(s.stream_icon) + '" tvg-chno="' + v(s.num) +
          '" group-title="' + v(catName[String(s.category_id)]) + '",' + v(s.name));   // il nome può contenere virgole
        out.push(x.srv + '/live/' + x.user + '/' + x.pass + '/' + encodeURIComponent(String(s.stream_id)) + '.m3u8');
      });
      return out.join('\n');
    });
  }

  // Account Xtream: aggiunto con utente e password (o, per le playlist salvate prima della 1.12, un indirizzo get.php).
  // Una playlist aggiunta come M3U resta M3U: si scarica così com'è.
  function isXtream(pl) { return !!pl && (pl.type === 'xtream' || (!pl.type && !!xtreamParts(pl.url))); }

  function fetchPlaylist(pl, meta) {
    var url = pl.url, x = isXtream(pl) ? xtreamParts(url) : null;
    if (x) return xtreamLive(x).then(function (text) { return { text: text, meta: {} }; }, function () {
      return download(url, { as: 'text', timeout: PLAYLIST_TIMEOUT, name: 'playlist' });        // fornitore senza API: m3u completo
    });
    return download(url, { as: 'text', timeout: PLAYLIST_TIMEOUT, name: 'playlist', meta: meta });
  }

  // Impronta veloce del testo: per capire se la playlist riscaricata è cambiata senza ridisegnare tutto.
  function textHash(s) {
    var h = 0, step = Math.max(1, Math.floor(s.length / 200000));
    for (var i = 0; i < s.length; i += step) h = (h * 31 + s.charCodeAt(i)) | 0;
    return s.length + ':' + h;
  }

  // Avvio: si mostra SUBITO la copia salvata della playlist (se c'è) e la si aggiorna dalla rete in sottofondo.
  // Prima si aspettava sempre il download completo prima di vedere qualcosa.
  function loadActive() {
    var pl = activePlaylist();
    var token = ++state.loadToken;
    if (!pl) { showWelcome(); return; }
    if (state.activeId !== pl.id) { state.activeId = pl.id; Store.set('activePlaylist', pl.id); }
    el.plName.textContent = pl.name;
    setStatus('Caricamento di “' + pl.name + '”…');
    state.channels = []; state.filtered = []; gridV.clear();
    var t0 = Date.now(), cached = null;
    Cache.get('cache:' + pl.id).then(function (c) {
      if (token !== state.loadToken) return;
      cached = c && c.text ? c : null;
      if (cached) {
        var list = M3U.parse(cached.text);
        if (list.length) { setChannels(list); Diag.since('Playlist dalla copia salvata (' + list.length + ' canali)', t0); }
      }
      var t1 = Date.now();
      return fetchPlaylist(pl, cached && cached.meta).then(function (r) {
        if (token !== state.loadToken) return;
        if (r.notModified && cached) { cached.t = Date.now(); Cache.set('cache:' + pl.id, cached); return; }
        var hash = textHash(r.text);
        if (cached && cached.hash === hash) { cached.t = Date.now(); Cache.set('cache:' + pl.id, cached); return; }
        var list = M3U.parse(r.text);
        if (!list.length) throw new Error('la playlist è vuota o non è un file M3U');
        Diag.since('Playlist scaricata (' + list.length + ' canali, ' + Math.round(r.text.length / 1024) + ' KB)', t1);
        Cache.set('cache:' + pl.id, { t: Date.now(), text: r.text, hash: hash, meta: r.meta || {} });
        setChannels(list);
        if (cached) toast('Playlist aggiornata', 2500);
      });
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      if (cached) { toast('Offline: uso la copia salvata della playlist', 4000); return; }
      setChannels([]);
      setStatus('Impossibile caricare la playlist (' + (err && err.message ? err.message : 'errore di rete') + '). Controlla la connessione o l\'URL nelle Impostazioni.', true);
    });
  }

  // Prima apertura (o nessuna playlist): tre modi per aggiungere la propria lista.
  function showWelcome() {
    setTimeout(markBootOk, 0);
    hideHome();
    state.channels = []; state.filtered = []; state.groups = [];
    el.plName.textContent = '';
    setStatus('');
    renderGroups();
    gridV.clear();
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
    var p = addPlaylistUrl(name || ('Account ' + srv.replace(/^https?:\/\//, '')), url, 'xtream');
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

  // ---------------------------------------------------------------- Home
  function firstMainItem() {
    if (!el.home.classList.contains('hidden')) return el.pvPanel;
    return el.grid.querySelector('.focusable');
  }

  function hideHome() {
    if (el.home.classList.contains('hidden')) return;
    previewStop();
    el.home.classList.add('hidden');
    el.grid.classList.remove('hidden');
    el.status.classList.remove('hidden');
  }

  function showHome() {
    gridV.clear();
    el.grid.classList.add('hidden');
    el.status.classList.add('hidden');
    $('grid-tools').classList.add('hidden');                              // "Riordina" solo nella cartella Preferiti
    if (state.reorder) stopReorder();
    el.home.classList.remove('hidden');
    renderHome();
    if (!state.pv.ch) {
      var last = channelByUrl(Store.get('lastChannel', ''));
      var favs = favChannels();
      state.pv.ch = last || favs[0] || state.channels[0] || null;
    }
    if (state.pv.ch && state.screen === 'browse') previewPlay(state.pv.ch);
  }

  function renderHome() {
    var now = Date.now();
    var favs = favChannels();
    // Guida: tutti i canali in ordine di numero, dall'1 in poi. Si ricostruisce solo se cambia la playlist,
    // e le righe si creano a blocchi (le TV caricano subito tutti i loghi: con 260 righe insieme andava a scatti).
    var key = state.activeId + ':' + state.channels.length;
    if (state.hgKey !== key || !hgV.attached) {
      state.hgKey = key;
      state.hgAll = state.channels.slice().sort(function (a, b) { return a.num - b.num; });
      hgV.reset();
    } else {
      hgV.forEach(function (r, i) { fillGuideRow(r, state.hgAll[i], now); });
    }
    updateClock();
    renderHomeTiles(favs, now);
  }

  // Una riga della guida della Home (la lista è "a finestra": vedi vlist.js).
  function makeGuideRow(i) {
    var ch = state.hgAll[i], now = Date.now();
    var r = document.createElement('div');
    r.className = 'hg-row focusable';
    r.setAttribute('data-action', 'homePlay');
    r.setAttribute('data-url', ch.url);
    var c = document.createElement('div'); c.className = 'hg-ch';
    var lg = document.createElement('div'); lg.className = 'hg-logo'; fillLogo(lg, ch);
    var nm = document.createElement('span'); nm.className = 'hg-num'; nm.textContent = ch.num;
    c.appendChild(lg); c.appendChild(nm);
    var pr = document.createElement('div'); pr.className = 'hg-prog';
    var l1 = document.createElement('div'); l1.className = 'hg-l1';
    var t = document.createElement('span'); t.className = 'hg-time';
    var p = document.createElement('span'); p.className = 'hg-title';
    var nx = document.createElement('div'); nx.className = 'hg-next';
    l1.appendChild(t); l1.appendChild(p); pr.appendChild(l1); pr.appendChild(nx);
    r.appendChild(c); r.appendChild(pr);
    fillGuideRow(r, ch, now);
    return r;
  }

  function renderHomeTiles(favs, now) {

    // Preferiti: fino a 8 loghi
    var ft = $('hf-tiles');
    ft.innerHTML = '';
    if (!favs.length) {
      var e = document.createElement('div'); e.className = 'tiles-empty';
      e.textContent = 'Premi Menu o il tasto Rosso su un canale per aggiungerlo ai preferiti.';
      ft.appendChild(e);
    }
    favs.slice(0, 6).forEach(function (ch) {
      var d = document.createElement('div');
      d.className = 'ftile focusable';
      d.setAttribute('data-action', 'homePlay');
      d.setAttribute('data-url', ch.url);
      var lg = document.createElement('div'); lg.className = 'ft-logo'; fillLogo(lg, ch);
      var nm = document.createElement('div'); nm.className = 'ft-name'; nm.textContent = ch.title;
      var nw = document.createElement('div'); nw.className = 'tile-now';
      d.appendChild(lg); d.appendChild(nm); d.appendChild(nw);
      ft.appendChild(d);
    });

    renderQuick();
  }

  // Canale "guardato": aperto a schermo intero, oppure rimasto almeno 10 secondi nell'anteprima della Home.
  // Il canale guardato prima diventa il "Canale precedente" (ricordato anche dopo un riavvio).
  function noteWatching(url) {
    if (!url) return;
    var cur = state.curUrl || Store.get('lastChannel', '');
    if (cur && cur !== url) { state.prevUrl = cur; Store.set('prevChannel', cur); }
    state.curUrl = url;
    Store.set('lastChannel', url);
  }

  // Riquadri "Canale precedente" e "Più visti" (si aggiornano da soli, senza ridisegnare la Home).
  function renderQuick() {
    var qp = $('hq-prev');
    qp.innerHTML = '';
    var prev = channelByUrl(state.prevUrl || Store.get('prevChannel', ''));
    if (prev) qp.appendChild(quickTile(prev, 'wide'));
    else { var q0 = document.createElement('div'); q0.className = 'tiles-empty'; q0.textContent = 'Qui compare il canale guardato prima di quello attuale.'; qp.appendChild(q0); }
    var qt = $('hq-top');
    qt.innerHTML = '';
    var top = mostWatched(3);
    if (!top.length) { var q1 = document.createElement('div'); q1.className = 'tiles-empty'; q1.textContent = 'I canali che guardi di più.'; qt.appendChild(q1); }
    top.forEach(function (ch) { qt.appendChild(quickTile(ch, '')); });
    refreshHome();                                                        // programmi in onda nei riquadri
  }

  function quickTile(ch, cls) {
    var d = document.createElement('div');
    d.className = 'qtile focusable ' + cls;
    d.setAttribute('data-action', 'homePlay');
    d.setAttribute('data-url', ch.url);
    var lg = document.createElement('div'); lg.className = 'qt-logo'; fillLogo(lg, ch);
    var tx = document.createElement('div'); tx.className = 'qt-text';
    var nm = document.createElement('div'); nm.className = 'qt-name'; nm.textContent = ch.num + '  ' + ch.title;
    var nw = document.createElement('div'); nw.className = 'qt-now tile-now';
    tx.appendChild(nm); tx.appendChild(nw);
    d.appendChild(lg); d.appendChild(tx);
    return d;
  }

  // Minuti di visione per canale: restano solo su questo dispositivo, al massimo 40 canali.
  function addWatch(url, sec) {
    var st = Store.get('watchStats', {});
    st[url] = (st[url] || 0) + sec;
    var keys = Object.keys(st);
    if (keys.length > 40) {
      keys.sort(function (x, y) { return st[y] - st[x]; });
      keys.slice(40).forEach(function (k) { delete st[k]; });
    }
    Store.set('watchStats', st);
  }

  function mostWatched(n) {
    var st = Store.get('watchStats', {});
    return Object.keys(st).sort(function (x, y) { return st[y] - st[x]; })
      .map(channelByUrl).filter(function (c) { return !!c; }).slice(0, n);
  }

  function fillGuideRow(r, ch, now) {
    var nn = EPG.nowNext(ch.epg, now);
    r.querySelector('.hg-time').textContent = nn.now ? hhmm(nn.now[0]) : '';
    r.querySelector('.hg-title').textContent = nn.now ? nn.now[2] : ch.title;
    r.querySelector('.hg-next').textContent = nn.next ? 'Poi ' + hhmm(nn.next[0]) + '  ' + nn.next[2] : '';
    r.classList.toggle('playing', !!(state.pv.ch && state.pv.ch.url === ch.url));
  }

  // Aggiorna i programmi in onda nella Home: ogni 30 secondi e appena arriva (o cambia) la guida TV.
  function refreshHome() {
    if (el.home.classList.contains('hidden')) return;
    var now = Date.now();
    hgV.forEach(function (r, i) { if (state.hgAll[i]) fillGuideRow(r, state.hgAll[i], now); });
    Array.prototype.forEach.call(el.home.querySelectorAll('.tile-now'), function (n) {
      var t = n.parentNode.getAttribute('data-url') ? n.parentNode : n.parentNode.parentNode;   // .qt-now sta dentro .qt-text
      var ch = channelByUrl(t.getAttribute('data-url'));
      var nn = ch ? EPG.nowNext(ch.epg, now) : {};
      n.textContent = nn.now ? nn.now[2] : '';
    });
    fillPreviewInfo();
  }

  var DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  var MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  function updateClock() {
    var d = new Date();
    el.clock.textContent = hhmm(d.getTime());
    var hd = $('hg-date');
    if (hd) hd.textContent = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + '   ' + hhmm(d.getTime());
  }

  // ---------- anteprima (senza audio: OK la apre a schermo intero)
  function fillPreviewInfo() {
    var ch = state.pv.ch, p = el.pvPanel;
    p.classList.toggle('empty', !ch);
    if (!ch) return;
    var lg = p.querySelector('.pv-logo');
    if (lg._url !== ch.url) { lg._url = ch.url; fillLogo(lg, ch); }       // prima si ricreava ogni 30 secondi
    p.querySelector('.pv-name').textContent = ch.num + '  ' + ch.title;
    var nn = EPG.nowNext(ch.epg, Date.now());
    p.querySelector('.pv-now').textContent = nn.now ? hhmm(nn.now[0]) + ' – ' + hhmm(nn.now[1]) + '   ' + nn.now[2] : '';
    var bar = p.querySelector('.pv-prog i');
    bar.style.width = nn.now ? Math.max(0, Math.min(100, (Date.now() - nn.now[0]) / (nn.now[1] - nn.now[0]) * 100)) + '%' : '0';
  }

  function previewStop() {
    var pv = state.pv;
    clearTimeout(pv.timer);
    if (pv.loader) pv.loader.stop();
    pv.playingUrl = '';
    clearTimeout(pv.watchTimer);
    el.pvPanel.classList.remove('loading');
  }

  function previewLoader() {
    var pv = state.pv;
    if (!pv.loader) {
      pv.loader = createLoader(el.pvVideo, {
        hls: { capLevelToPlayerSize: true, startLevel: 0, maxBufferLength: 10, maxMaxBufferLength: 15,
          backBufferLength: 0, maxBufferSize: 15 * 1000 * 1000, fragLoadingMaxRetry: 2 },
        onMode: function (mode, hls) { pv.hls = hls; },
        onPlaying: function () { el.pvPanel.classList.remove('loading'); },
        onFail: function () { previewStop(); }
      });
    }
    return pv.loader;
  }

  function previewPlay(ch) {
    var pv = state.pv;
    pv.ch = ch;
    fillPreviewInfo();
    hgV.forEach(function (r) { r.classList.toggle('playing', r.getAttribute('data-url') === ch.url); });
    if (background || state.screen !== 'browse' || el.home.classList.contains('hidden')) return;
    if (pv.playingUrl === ch.url) return;
    previewStop();
    pv.ch = ch;
    if (!/^https?:\/\//i.test(ch.url) || blockedLan(ch.url)) return;
    pv.playingUrl = ch.url;
    clearTimeout(pv.watchTimer);
    pv.watchTimer = setTimeout(function () {                              // 10 secondi in anteprima = "guardato"
      if (pv.playingUrl !== ch.url || state.screen !== 'browse') return;
      var before = state.prevUrl;
      noteWatching(ch.url);
      if (state.prevUrl !== before) renderQuick();
    }, 10000);
    el.pvPanel.classList.add('loading');
    previewLoader().start(ch.url);
  }

  // ---------------------------------------------------------------- Caricatore dei flussi
  // Unico per lettore, anteprima e multivisione. Prova un metodo (hls.js o lettore nativo) e, se fallisce o non
  // parte entro il tempo limite, l'altro; ogni tentativo ha il suo timer. Ricorda per ogni server quale metodo ha
  // funzionato, così al cambio canale si parte subito da quello giusto (su Fire TV hls.js fallisce con i server
  // senza CORS: prima ogni cambio canale aspettava i ritentativi di hls.js prima di passare al nativo).
  var streamModes = Store.get('streamModes', {});
  function streamHost(url) { var m = /^[a-z]+:\/\/(?:[^@\/]*@)?([^\/?#]+)/i.exec(url || ''); return m ? m[1].toLowerCase() : ''; }
  function looksHls(url) { return /\.m3u8?(\?|$)|\/hls\/|m3u8/i.test(url); }
  function rememberMode(url, mode) {
    var h = streamHost(url);
    if (!h || streamModes[h] === mode) return;
    streamModes[h] = mode;
    var keys = Object.keys(streamModes);
    if (keys.length > 200) delete streamModes[keys[0]];
    Store.set('streamModes', streamModes);
  }
  function modeOrder(url) {
    if (!hlsJsSupported()) return ['native'];
    if (looksHls(url)) return streamModes[streamHost(url)] === 'native' ? ['native', 'hlsjs'] : ['hlsjs', 'native'];
    return ['native', 'hlsjs'];
  }

  // cfg: hls (opzioni hls.js), timeout, onMode(mode, hls), onHls(hls), onPlaying(), onFail(msg),
  //      onFirstFail(msg) → true per non provare il secondo metodo.
  function createLoader(video, cfg) {
    var L = { url: '', mode: null, hls: null, token: 0, timer: null, ok: false };
    var timeout = cfg.timeout || STREAM_TIMEOUT;
    function setMode(mode, hls) { L.mode = mode; L.hls = hls; if (cfg.onMode) cfg.onMode(mode, hls); }
    function teardown() {
      clearTimeout(L.timer);
      if (L.hls) { try { L.hls.destroy(); } catch (e) { /* ignora */ } }
      setMode(null, null);
      try { video.pause(); } catch (e) { /* ignora */ }
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* ignora */ }
    }
    function play() { var p = video.play(); if (p && p.catch) p.catch(function () { /* autoplay bloccato */ }); }
    function failAttempt(msg, token) {
      if (token !== L.token) return;
      var url = L.url;
      teardown();
      if (L.attempt === 0 && cfg.onFirstFail && cfg.onFirstFail(msg)) return;
      if (L.attempt + 1 < L.order.length) { L.attempt++; tryMode(); return; }
      L.token++;
      if (cfg.onFail) cfg.onFail(msg, url);
    }
    function tryMode() {
      var token = L.token, mode = L.order[L.attempt], url = L.url;
      L.netRetry = false; L.mediaRetry = false; L.ok = false;
      clearTimeout(L.timer);
      L.timer = setTimeout(function () { failAttempt('Il canale non risponde.', token); }, timeout);
      if (mode === 'hlsjs') {
        var Hls = window.Hls, opts = {}, k;
        for (k in cfg.hls) opts[k] = cfg.hls[k];
        // Manifest: un solo nuovo tentativo, breve (un server che rifiuta non cambia idea dopo 3 secondi).
        if (opts.manifestLoadingMaxRetry === undefined) opts.manifestLoadingMaxRetry = 1;
        if (opts.manifestLoadingRetryDelay === undefined) opts.manifestLoadingRetryDelay = 500;
        var hls = new Hls(opts);
        setMode('hlsjs', hls);
        hls.on(Hls.Events.ERROR, function (ev, d) {
          if (!d.fatal || L.hls !== hls || token !== L.token) return;
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR && !L.netRetry && d.details !== 'manifestLoadError') {
            L.netRetry = true; setTimeout(function () { if (L.hls === hls) hls.startLoad(); }, 1000);
          } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !L.mediaRetry) {
            L.mediaRetry = true; hls.recoverMediaError();
          } else {
            failAttempt(d.details === 'manifestLoadError' ? 'Il server del canale non risponde o blocca la riproduzione.' :
              'Errore di riproduzione (' + d.details + ').', token);
          }
        });
        hls.on(Hls.Events.MANIFEST_PARSED, play);
        if (cfg.onHls) cfg.onHls(hls);
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        setMode('native', null);
        video.src = url;
        play();
      }
    }
    video.addEventListener('playing', function () {
      if (!L.url || L.ok) return;
      L.ok = true;
      clearTimeout(L.timer);
      rememberMode(L.url, L.mode);
      if (cfg.onPlaying) cfg.onPlaying();
    });
    video.addEventListener('error', function () {
      if (L.url && L.mode === 'native' && video.getAttribute('src')) failAttempt('Formato non supportato o canale offline.', L.token);
    });
    L.start = function (url) {
      L.token++;
      teardown();
      L.url = url; L.ok = false; L.attempt = 0; L.order = modeOrder(url);
      tryMode();
    };
    L.stop = function () { L.token++; L.url = ''; L.ok = false; teardown(); };
    // Cambia metodo a riproduzione avviata (es. errore definitivo a metà): come un fallimento del tentativo.
    L.fail = function (msg) { failAttempt(msg, L.token); };
    return L;
  }

  // Home ferma per 1 minuto (nessun tasto) con l'anteprima in riproduzione: il canale si apre a schermo intero.
  // Evita che la TV oscuri la pagina lasciando visibile solo il riquadro del video (succedeva su LG).
  var IDLE_FULL_MS = 60 * 1000, idleTimer = null;
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(idleFull, IDLE_FULL_MS);
  }
  function idleFull() {
    var cur = Nav.current(), ae = document.activeElement;
    var ready = !background && state.screen === 'browse' && !el.home.classList.contains('hidden') &&
      state.pv.ch && state.pv.playingUrl === state.pv.ch.url && !el.pvPanel.classList.contains('loading') &&
      el.pair.classList.contains('hidden') && cur && el.screens.browse.contains(cur) && !(ae && ae.tagName === 'INPUT');
    if (ready) actions.previewFull();
    else { clearTimeout(idleTimer); idleTimer = setTimeout(idleFull, 5000); }   // ricontrolla tra poco (nessun tasto premuto nel frattempo)
  }

  // Controllo aggiornamenti: legge un file statico pubblico (nessun dato inviato: niente cookie, niente referrer).
  // Se c'è una versione nuova compare il pulsante accanto a Impostazioni; non succede altro finché non lo premi.
  function newerVersion(a, b) {
    a = String(a).split('.'); b = String(b).split('.');
    for (var i = 0; i < 3; i++) { var x = +a[i] || 0, y = +b[i] || 0; if (x !== y) return x > y; }
    return false;
  }

  function checkUpdate(force, done) {
    done = done || function () {};
    if (!state.updCheck || !window.fetch) { done(); return; }
    var now = Date.now();
    if (!force && now - state.updLast < 60 * 60e3) { done(); return; }                    // al massimo una volta l'ora
    state.updLast = now;
    fetch(VERSION_URL + '?v=' + Math.floor(now / 60000), { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (v) {
        if (!v || typeof v.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(v.version) || !newerVersion(v.version, APP_VERSION)) {
          showUpdateBox(null); done(); return;
        }
        var apk = v.apk && typeof v.apk.url === 'string' && v.apk.url.indexOf(UPDATE_PREFIX) === 0 &&
          /^[0-9a-f]{64}$/.test(v.apk.sha256 || '') ? { url: v.apk.url, sha256: v.apk.sha256 } : null;
        var web = v.web && typeof v.web.url === 'string' && v.web.url.indexOf(WEB_PREFIX) === 0 && /^[\w.-]+\.json$/.test(v.web.url.slice(WEB_PREFIX.length)) &&
          /^[A-Za-z0-9+\/]{86}==$/.test(v.web.sig || '') ? { url: v.web.url, sig: v.web.sig } : null;
        showUpdateBox({ version: v.version, apk: apk, web: web });
        done();
      }, function () { done(); /* niente rete o file assente: si riprova più tardi */ });
  }

  // Riquadro in basso a sinistra: al posto di "BTV Player" compare "È disponibile un aggiornamento".
  function showUpdateBox(u) {
    state.update = u;
    var on = !!u;
    if (!on && Nav.current() === el.updBtn) Nav.focus(activeGroupEl());
    el.updBtn.classList.toggle('hidden', !on);
    $('side-info').classList.toggle('hidden', on);
    if (on) {
      $('upd-ver').textContent = 'Versione ' + u.version +
        ((platform === 'android' && u.apk) || (TV_SELF_UPDATE && u.web) ? ' · premi OK per installarla' : platform === 'web' ? ' · premi OK' : ' · si installa dal PC');
    }
  }

  function installUpdate() {
    var u = state.update;
    if (!u) return;
    var S = platform === 'android' ? capPlugin('Screen') : null;
    if (S && S.installUpdate && u.apk) {
      toast('Scarico la versione ' + u.version + '…', 10000);
      S.installUpdate({ url: u.apk.url, sha256: u.apk.sha256 }).then(function () {
        toast('Conferma l\'installazione: BTV si riapre aggiornata', 6000);
      }, function (e) {
        var msg = e && e.message || '';
        if (msg === 'PERMESSO') toast('Consenti a BTV di installare aggiornamenti (si è aperta l\'impostazione), poi premi di nuovo Aggiornamento', 9000);
        else toast('Aggiornamento non riuscito: ' + msg, 6000);
      });
    } else if (TV_SELF_UPDATE && u.web) {
      // LG / Samsung: scarica il codice nuovo, verifica la firma (chiave in boot.js) e lo usa dal prossimo avvio.
      toast('Scarico la versione ' + u.version + '…', 10000);
      fetch(u.web.url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (text) {
          if (text.length > 4 * 1024 * 1024) throw new Error('file troppo grande');
          if (!window.BTV_VERIFY(text, u.web.sig)) throw new Error('firma non valida');
          var b = JSON.parse(text);
          if (!b || b.version !== u.version || !newerVersion(b.version, APP_VERSION) || !b.files) throw new Error('versione non corrispondente');
          if (!Store.set('webBundle', { text: text, sig: u.web.sig })) throw new Error('memoria piena');
          toast('Versione ' + u.version + ' installata: riavvio BTV…', 4000);
          setTimeout(function () { location.reload(); }, 1800);
        })
        .catch(function (e) { toast('Aggiornamento non riuscito: ' + (e && e.message || 'errore'), 7000); });
    } else if (platform === 'web') {
      location.reload();
    } else {
      toast('Versione ' + u.version + ' disponibile. Su questa TV l\'aggiornamento si installa dal PC (tools\\install-lg.ps1): la TV non permette alle app di aggiornarsi da sole.', 9000);
    }
  }

  var bootOk = false;
  function markBootOk(fromTimer) {
    if (bootOk) return;
    bootOk = true;
    if (fromTimer !== true) Diag.since('Avvio fino alla prima schermata utile', Diag.start);
    if (window.BTV_BUNDLE) { try { localStorage.setItem('bundleOk', window.BTV_BUNDLE.version); } catch (e) { /* ignora */ } }
  }

  function setChannels(list) {
    setTimeout(markBootOk, 0);   // dopo il disegno: se il disegno stesso fallisce, l'avvio non conta come riuscito
    // Film ed episodi di una playlist M3U vanno in "Film e serie", non tra i canali (né nella guida o nei numeri).
    var live = [], vod = [];
    list.forEach(function (ch) { (isVodUrl(ch.url) ? vod : live).push(ch); });
    live.epgUrls = list.epgUrls;
    list = live;
    state.vodM3u = vod;
    state.vod = null;                                                     // si ricomincia dalla radice di Film e serie
    list.forEach(function (ch, i) {
      ch.num = parseInt(ch.chno, 10) || (i + 1);
      ch.title = cleanName(ch.name);
    });
    state.channels = list;
    state.playlistEpg = (list.epgUrls || []).filter(function (u) { return /^https?:\/\//i.test(u) && !blockedLan(u); });
    var counts = {};
    list.forEach(function (ch) { ch.groups.forEach(function (g) { counts[g] = (counts[g] || 0) + 1; }); });
    state.groups = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); })
      .map(function (g) { return { id: g, name: g, count: counts[g] }; });
    if (state.group !== '__all' && state.group !== '__fav' && state.group !== '__home' && !(state.group === '__vod' && hasVod()) && !counts[state.group]) state.group = '__home';
    renderGroups();
    applyFilter();
    if (state.screen === 'browse') {
      var c = Nav.current();
      if (!c || !document.body.contains(c)) Nav.setRoot(el.screens.browse, gridV.ensure(0) || activeGroupEl());
    }
    if (list.length) loadEpg(false);
    // All'avvio l'ultimo canale visto riparte nell'anteprima della Home (senza audio): lo schermo intero
    // si apre solo quando lo chiedi tu (OK). Si disattiva nelle Impostazioni.
    if (!state.resumed && list.length) {
      state.resumed = true;
      if (state.screen === 'browse' && !el.home.classList.contains('hidden')) {
        if (!state.resumeLast) { previewStop(); state.pv.ch = null; fillPreviewInfo(); }
        Nav.setRoot(el.screens.browse, el.pvPanel);
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


  // Analisi in un Web Worker (l'interfaccia resta fluida); se non disponibile, sul thread principale.
  var epgWorker = null, epgWorkerBroken = false;
  function makeEpgWorker() {
    var B = window.BTV_BUNDLE, f = B && B.files;
    if (f && f['js/epg.js'] && f['js/epg-worker.js'] && f['vendor/pako_inflate.min.js'] && window.Blob && window.URL) {
      var code = f['vendor/pako_inflate.min.js'] + '\n' + f['js/epg.js'] + '\n' + f['js/epg-worker.js'].replace(/importScripts\([^)]*\);?/, '');
      return new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    }
    return new Worker('js/epg-worker.js');
  }

  // src = { bytes } (byte già scaricati, passati al Worker senza copie) oppure { url } (file locale del download
  // nativo su Fire TV: lo legge il Worker a pezzi, i byte non passano mai dalla pagina).
  function parseGuide(src, now) {
    function onMain() {                                                 // senza Worker (raro): pako si carica solo qui
      var lib = window.pako ? Promise.resolve() : loadLib('vendor/pako_inflate.min.js');
      return lib.then(function () {
        if (src.bytes) return EPG.parseBytes(src.bytes, window.pako, now, EPG_FUTURE);
        return fetch(src.url).then(function (r) { return r.arrayBuffer(); })
          .then(function (b) { return EPG.parseBytes(new Uint8Array(b), window.pako, now, EPG_FUTURE); });
      });
    }
    if (epgWorkerBroken || !window.Worker) return Promise.resolve().then(onMain);
    return new Promise(function (resolve, reject) {
      try {
        if (!epgWorker) epgWorker = makeEpgWorker();
      } catch (e) {
        epgWorkerBroken = true;
        Promise.resolve().then(onMain).then(resolve, reject);
        return;
      }
      var guard = setTimeout(function () {
        try { epgWorker.terminate(); } catch (x) { /* ignora */ }
        epgWorker = null;
        reject(new Error('guida troppo lenta da analizzare'));
      }, 90000);
      epgWorker.onmessage = function (e) {
        clearTimeout(guard);
        if (e.data.ok) { resolve(e.data.guide); return; }
        // Il Worker non riesce a leggere il file locale (alcune WebView): lo legge la pagina e glielo passa.
        if (src.url && /fetch|HTTP|network/i.test(e.data.error || '')) {
          fetch(src.url).then(function (r) { return r.arrayBuffer(); })
            .then(function (b) { return parseGuide({ bytes: new Uint8Array(b) }, now); }).then(resolve, reject);
          return;
        }
        reject(new Error(e.data.error));
      };
      epgWorker.onerror = function (e) {
        clearTimeout(guard);
        if (e && e.preventDefault) e.preventDefault();
        epgWorkerBroken = true; epgWorker = null;
        Promise.resolve().then(onMain).then(resolve, reject);
      };
      if (src.bytes) {
        var bytes = src.bytes, buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        epgWorker.postMessage({ buf: buf, now: now, future: EPG_FUTURE }, [buf]);
      } else {
        epgWorker.postMessage({ url: src.url, now: now, future: EPG_FUTURE });
      }
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
    var t0 = Date.now();
    // La copia salvata si legge da IndexedDB senza bloccare l'interfaccia (prima: JSON di più MB letto all'avvio).
    Cache.get('epg:' + pl.id).then(function (cache) {
      if (token !== state.epgToken) return;
      if (cache && cache.data && !force) { attachGuides([cache.data]); Diag.since('Guida dalla copia salvata', t0); }
      if (!force && cache && Date.now() - cache.t < EPG_MAX_AGE) { state.epgLoading = false; updateEpgLabel(); return; }
      state.epgLoading = true; updateEpgLabel();
      var guides = [], failed = [], i = 0, now = Date.now(), metas = {};
      // Con una sola fonte (il caso più comune: la guida del fornitore) si chiede al server se è cambiata:
      // se no, si tiene la copia salvata senza riscaricare decine di MB (solo Fire TV, dove il download è nativo).
      var oldMeta = urls.length === 1 && cache && cache.data && cache.meta ? cache.meta[urls[0]] : null;
      (function next() {
        if (token !== state.epgToken) return;
        if (i >= urls.length) {
          state.epgLoading = false;
          if (guides.length) {
            attachGuides(guides);
            Diag.since('Guida scaricata e analizzata (' + guides.length + ' fonti, ' + state.epgCount + ' canali)', t0);
            // Una sola guida in cache (la playlist attiva) per non riempire la memoria della TV.
            state.playlists.forEach(function (p) { if (p.id !== pl.id) Cache.remove('epg:' + p.id); });
            Cache.set('epg:' + pl.id, { t: Date.now(), data: EPG.compact(guides, state.channels), meta: metas });
          } else if (!cache) {
            clearEpg();
          }
          if (failed.length && force) toast('Guida: ' + failed.length + ' fonte/i non raggiungibili', 3500);
          updateEpgLabel();
          return;
        }
        var url = urls[i++];
        download(url, { as: nativeDl() ? 'file' : 'bytes', timeout: GUIDE_TIMEOUT, name: 'epg-' + (token % 4) + '-' + i, meta: oldMeta })
          .then(function (r) {
            if (r.notModified && cache && cache.data) {                 // non cambiata: resta la copia salvata
              cache.t = Date.now();
              Cache.set('epg:' + pl.id, cache);
              i = urls.length;
              guides = null;
              return 'kept';
            }
            metas[url] = r.meta || {};
            return parseGuide(r.fileUrl ? { url: r.fileUrl } : { bytes: r.bytes }, now);
          })
          .then(function (g) {
            if (g === 'kept') {
              if (token !== state.epgToken) return;
              state.epgLoading = false; updateEpgLabel();
              Diag.since('Guida non cambiata sul server: copia salvata', t0);
              return 'stop';
            }
            guides.push(g);
            // Alleggerimento: se le guide scaricate coprono già quasi tutti i canali, salta le altre fonti
            // (risparmia download e lavoro alla Fire TV; la guida della playlist viene sempre provata per prima).
            if (state.channels.length && EPG.match(state.channels, guides) >= state.channels.length * 0.9) i = urls.length;
          })
          .catch(function (e) { failed.push(url); if (window.console) console.warn('Guida TV non caricata:', maskUrl(url), e && e.message); })
          .then(function (x) { if (x !== 'stop') next(); });
      })();
    });
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
  // fromTimer: chiamata del minuto (la Home ha già il suo aggiornamento ogni 30 s; la griglia solo se è visibile).
  function refreshEpgViews(fromTimer) {
    var now = Date.now();
    if (fromTimer !== true || state.screen === 'browse') {
      gridV.forEach(function (card, i) { if (state.filtered[i] && !state.filtered[i].vod) fillCardEpg(card, state.filtered[i], now); });
    }
    if (state.screen === 'player' && osdVisible()) fillOsdEpg();
    if (state.guide) renderGuide(false);
    if (state.multi) state.multi.tiles.forEach(function (t) { if (t.ch) fillTileEpg(t); });
    if (fromTimer !== true) refreshHome();
    updateEpgLabel();
  }

  function setStatus(msg, isError) {
    el.status.textContent = msg || '';
    el.status.className = isError ? 'error' : '';
  }

  // ---------------------------------------------------------------- Elenco
  // Preferiti nell'ordine scelto dall'utente (Preferiti → Riordina); i nuovi vanno in fondo.
  function favChannels() {
    var pos = {};
    state.favOrder.forEach(function (u, i) { pos[u] = i; });
    return state.channels.filter(function (c) { return state.favorites[c.url]; })
      .map(function (c, i) { return { c: c, k: pos.hasOwnProperty(c.url) ? pos[c.url] : 1e6 + i }; })
      .sort(function (a, b) { return a.k - b.k; })
      .map(function (x) { return x.c; });
  }

  function saveFavOrder(urls) {
    state.favOrder = urls.slice(0, 2000);
    Store.set('favOrder', state.favOrder);
  }

  function favCount() {
    var n = 0;
    state.channels.forEach(function (ch) { if (state.favorites[ch.url]) n++; });
    return n;
  }

  // ---------------------------------------------------------------- Riordino dei preferiti
  function startReorder() {
    state.reorder = { moving: -1 };
    el.grid.classList.add('reordering');
    setIc($('btn-reorder'), 'check', 'Fine riordino');
    $('reorder-hint').textContent = 'OK prende un canale · frecce lo spostano · OK lo lascia · Indietro per finire';
    var c0 = gridV.ensure(0);
    if (c0) Nav.focus(c0);
  }

  function stopReorder() {
    state.reorder = null;
    el.grid.classList.remove('reordering');
    Array.prototype.forEach.call(el.grid.querySelectorAll('.moving'), function (c) { c.classList.remove('moving'); });
    setIc($('btn-reorder'), 'swap', 'Riordina preferiti');
    $('reorder-hint').textContent = '';
    if (!el.home.classList.contains('hidden')) renderHome();
  }

  function moveFav(from, to) {
    var list = state.filtered;
    if (to < 0 || to >= list.length || to === from) return from;
    var item = list.splice(from, 1)[0];
    list.splice(to, 0, item);
    // i preferiti nascosti (es. canali non funzionanti) restano in fondo
    var shown = list.map(function (c) { return c.url; });
    saveFavOrder(shown.concat(favChannels().map(function (c) { return c.url; }).filter(function (u) { return shown.indexOf(u) < 0; })));
    gridV.refresh();
    var card = gridV.ensure(to);
    card.classList.add('moving');
    Nav.focus(card);
    return to;
  }

  function reorderKey(a) {
    var r = state.reorder, cur = Nav.current();
    if (a === 'back') { stopReorder(); Nav.focus($('btn-reorder')); return true; }
    if (!cur || !cur.classList.contains('card')) return false;
    var i = +cur.getAttribute('data-idx');
    if (a === 'enter') {
      if (r.moving < 0) { r.moving = i; cur.classList.add('moving'); }
      else { r.moving = -1; cur.classList.remove('moving'); toast('Posizione salvata'); }
      return true;
    }
    if (r.moving < 0) return false;                                       // nessun canale preso: frecce normali
    var cols = gridV.cols();
    var to = a === 'left' ? i - 1 : a === 'right' ? i + 1 : a === 'up' ? i - cols : a === 'down' ? i + cols : -1;
    if (to < 0) return a === 'left' || a === 'right' || a === 'up' || a === 'down';
    r.moving = moveFav(i, Math.min(to, state.filtered.length - 1));
    return true;
  }

  // Barra laterale: Home, Preferiti e Tutti i canali in grassetto con icona; poi le categorie della playlist, solo col nome.
  function renderGroups() {
    el.groups.innerHTML = '';
    var items = [
      { id: '__home', name: 'Home', icon: 'home', count: '' },
      { id: '__fav', name: 'Preferiti', icon: 'starf', count: favCount() },
      { id: '__all', name: 'Tutti i canali', icon: 'tv', count: state.channels.length }
    ].concat(hasVod() ? [{ id: '__vod', name: 'On demand', icon: 'film', count: state.vodM3u && state.vodM3u.length ? state.vodM3u.length : '' }] : [])
      .concat(state.groups);
    items.forEach(function (g) {
      var b = document.createElement('div');
      b.className = 'group focusable' + (g.icon ? ' special' : '') + (g.id === state.group ? ' active' : '');
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
    if (state.reorder) stopReorder();
    state.group = id;
    Array.prototype.forEach.call(el.groups.children, function (g) {
      g.classList.toggle('active', g.getAttribute('data-group') === id);
    });
    applyFilter();
  }

  function applyFilter() {
    if (!activePlaylist()) { showWelcome(); return; }   // nessuna playlist: resta il benvenuto
    if (state.group === '__home' && !state.query) { showHome(); return; }
    hideHome();
    if (state.group === '__vod') { vodRender(); return; }
    var q = state.query.toLowerCase();
    var g = state.group;
    state.filtered = (g === '__fav' ? favChannels() : state.channels).filter(function (ch) {
      if (g !== '__fav' && g !== '__all' && ch.groups.indexOf(g) < 0) return false;
      if (state.hideDead && state.dead[ch.url]) return false;
      return !q || ch.name.toLowerCase().indexOf(q) >= 0;
    });
    gridV.reset();
    var canReorder = g === '__fav' && !q && state.filtered.length > 1;
    $('grid-tools').classList.toggle('hidden', !canReorder);
    if (!canReorder && state.reorder) stopReorder();
    if (!state.channels.length) return;
    if (!state.filtered.length) {
      setStatus(g === '__fav' && !q ? 'Nessun preferito: premi Menu o il tasto Rosso su un canale per aggiungerlo.' : 'Nessun canale trovato.');
    } else {
      setStatus(state.filtered.length + (state.filtered.length === 1 ? ' canale' : ' canali') + (q ? ' per “' + state.query + '”' : ''));
    }
  }

  function makeCard(ch, i) {
    if (ch.vod) return makeVodCard(ch, i);
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

  // Impostazioni: su/giù vanno sempre alla riga successiva (elementi alla stessa altezza = una riga), scegliendo
  // l'elemento più vicino in orizzontale. Prima la ricerca geometrica preferiva elementi allineati più lontani e
  // saltava le righe con i pulsanti a destra (Usa / Elimina di playlist e guide).
  function rowNav(root, from, dir) {
    var items = Array.prototype.filter.call(root.querySelectorAll('.focusable'), function (e) { return e.offsetParent !== null; });
    var fr = from.getBoundingClientRect(), fc = (fr.left + fr.right) / 2;
    var best = null, bestRow = dir === 'down' ? Infinity : -Infinity, bestDx = Infinity;
    items.forEach(function (e) {
      if (e === from) return;
      var r = e.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var top = Math.round(r.top);
      if (dir === 'down' ? r.top < fr.bottom - 4 : r.bottom > fr.top + 4) return;
      var dx = Math.abs((r.left + r.right) / 2 - fc);
      var closerRow = dir === 'down' ? top < bestRow - 6 : top > bestRow + 6;
      var sameRow = Math.abs(top - bestRow) <= 6;
      if (closerRow || (sameRow && dx < bestDx)) { best = e; bestRow = top; bestDx = dx; }
    });
    return best;
  }

  // Regole di navigazione specifiche dell'elenco (più veloci e prevedibili della geometria).
  function customNav(from, dir) {
    if (state.screen === 'settings' && (dir === 'up' || dir === 'down')) return rowNav(el.screens.settings, from, dir) || false;
    if (state.screen === 'browse') {
      if (from.classList.contains('card')) {
        var i = +from.getAttribute('data-idx');
        var cols = gridV.cols(), n = state.filtered.length;
        var col = i % cols;
        if (dir === 'right') return (col < cols - 1 && i + 1 < n) ? gridV.ensure(i + 1) : false;
        if (dir === 'left') return col > 0 ? gridV.ensure(i - 1) : activeGroupEl();
        if (dir === 'down') {
          if (i + cols < n) return gridV.ensure(i + cols);
          if (Math.floor((n - 1) / cols) > Math.floor(i / cols)) return gridV.ensure(n - 1);
          return false;
        }
        if (dir === 'up') return i - cols >= 0 ? gridV.ensure(i - cols) : ($('grid-tools').classList.contains('hidden') ? el.search : $('btn-reorder'));
      }
      // Guida della Home: su/giù vanno alla riga accanto per indice (prima Nav misurava la posizione di tutti gli
      // elementi a ogni pressione: più righe caricate, più lento). Sinistra/destra restano geometriche.
      if (from.classList.contains('hg-row')) {
        var hi = hgV.index(from), hn = (state.hgAll || []).length;
        if (dir === 'down') return hi >= 0 && hi + 1 < hn ? hgV.ensure(hi + 1) : false;
        if (dir === 'up' && hi > 0) return hgV.ensure(hi - 1);
        return null;
      }
      if (from.classList.contains('group')) {
        if (dir === 'right') {
          clearTimeout(state.timers.group);
          selectGroup(from.getAttribute('data-group'));
          return firstMainItem() || el.search;
        }
        if (dir === 'up' && !from.previousSibling) return false;
        if (dir === 'down' && !from.nextSibling) return el.updBtn.classList.contains('hidden') ? false : el.updBtn;  // in fondo: aggiornamento
        if (dir === 'up') return from.previousSibling;
        if (dir === 'down') return from.nextSibling;
      }
      if (from === el.updBtn) {
        if (dir === 'up') return el.groups.lastChild || false;
        if (dir === 'right') return firstMainItem() || el.search;
        return false;
      }
      var top = [el.search, el.multiBtn, el.settingsBtn].filter(function (x) { return x && !x.classList.contains('hidden'); });
      var ti = top.indexOf(from);
      if (ti >= 0) {
        if (dir === 'down') return firstMainItem() || activeGroupEl();
        if (dir === 'up') return false;
        if (dir === 'left') return ti > 0 ? top[ti - 1] : activeGroupEl();
        return top[ti + 1] || false;
      }
    }
    if (state.screen === 'player' && (dir === 'up' || dir === 'down')) return false;
    return null;
  }

  // Seleziona la categoria quando il focus ci si ferma sopra.
  function onFocusChange() {
    var c = Nav.current();
    clearTimeout(state.timers.group);
    clearTimeout(state.pv.timer);
    // Muoversi nella guida NON cambia canale: si cambia solo con OK.
    if (c && c.classList.contains('group')) {
      state.timers.group = setTimeout(function () { selectGroup(c.getAttribute('data-group')); }, 280);
    }
  }

  function toggleFav(ch) {
    if (!ch) return;
    if (ch.vod) { toast('I preferiti sono per i canali in diretta'); return; }
    if (state.favorites[ch.url]) {
      delete state.favorites[ch.url];
      saveFavOrder(state.favOrder.filter(function (u) { return u !== ch.url; }));
    } else {
      state.favorites[ch.url] = true;
      saveFavOrder(state.favOrder.filter(function (u) { return u !== ch.url; }).concat([ch.url]));
    }
    var saved = Store.set('favorites', state.favorites);
    var isFav = !!state.favorites[ch.url];
    if (!saved) toast('Memoria piena: preferiti non salvati. Elimina una playlist che non usi.', 5000);
    else toast(isFav ? 'Aggiunto ai preferiti: ' + ch.title : 'Rimosso dai preferiti: ' + ch.title);
    // aggiorna card e contatore senza ridisegnare tutto
    gridV.forEach(function (card, i) {
      var c = state.filtered[i];
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
    if (name !== 'browse') previewStop();
    else if (state.group === '__home' && !el.home.classList.contains('hidden') && state.pv.ch) previewPlay(state.pv.ch);
    if (name === 'browse') checkUpdate(false);
  }

  function openSettings() {
    state.returnFocus = Nav.current();
    renderPlaylists();
    renderEpgSources();
    updateMultiPrefLabel();
    updateOptLabels();
    var tvUpd = window.BTV_BUNDLE && window.BTV_BASE_VERSION && window.BTV_BUNDLE.version !== window.BTV_BASE_VERSION;
    $('opt-reset-upd').classList.toggle('hidden', !tvUpd);
    $('app-version').textContent = 'BTV versione ' + APP_VERSION + (tvUpd ? ' (aggiornata dalla TV, installata: ' + window.BTV_BASE_VERSION + ')' : '') + '  ·  ' + platform +
      (platform === 'android' && /^https:/.test(location.href) && !/localhost/.test(location.host) ? '  ·  aggiornamenti automatici attivi' : '');
    show('settings');
  }

  function closeDiag() { state.diagOpen = false; $('diag-panel').classList.add('hidden'); }

  function showAddTab(t) {
    $('add-xt').classList.toggle('hidden', t !== 'xt');
    $('add-m3u').classList.toggle('hidden', t !== 'm3u');
    $('tab-xt').classList.toggle('active', t === 'xt');
    $('tab-m3u').classList.toggle('active', t === 'm3u');
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
      var u = document.createElement('div'); u.className = 'pl-url'; u.textContent = (isXtream(p) ? 'Account Xtream · ' : 'Playlist M3U · ') + (p.preset ? p.url : maskUrl(p.url));
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

  // ---------------------------------------------------------------- Film e serie (on demand)
  // Account Xtream: categorie, film e serie si chiedono al fornitore solo quando si aprono (una categoria alla volta:
  // niente cataloghi da decine di migliaia di titoli in memoria). Playlist M3U: i film e gli episodi trovati nella
  // playlist (indirizzi /movie/, /series/ o file video) sono raggruppati per categoria.
  // La griglia mostra un livello alla volta (cartelle → titoli → stagioni → episodi); Indietro risale.
  function isVodUrl(u) {
    return /\/(movie|series)\/[^\/?#]+\/[^\/?#]+\/[^\/?#]+$/i.test(u || '') || /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm|mpg|mpeg)(\?|$)/i.test(u || '');
  }

  function hasVod() {
    var pl = activePlaylist();
    return !!pl && (isXtream(pl) || !!(state.vodM3u && state.vodM3u.length));
  }

  function vodEntry(o) { o.vod = true; o.name = o.title; o.num = ''; if (!o.groups) o.groups = []; return o; }

  function xtApi(action) {
    var x = xtreamParts(activePlaylist().url);
    return httpGet(x.srv + '/player_api.php?' + x.q + '&action=' + action).then(function (t) {
      var j = JSON.parse(t);
      if (j && j.user_info && String(j.user_info.auth) === '0') throw new Error('accesso rifiutato');
      return j;
    });
  }

  function xtExt(e, def) { var x = String(e || def).replace(/[^a-z0-9]/gi, ''); return x || def; }

  // Sport on demand (partite, gare): titoli SENZA scheda di film (TMDB) il cui genere (es. "Calcio · Serie A") o nome
  // parla di sport. Chi ha una scheda TMDB è sempre un film, anche se sportivo (es. "Rocky": "Dramma, Sport").
  var SPORT_RE = /calcio|serie [abc]\b|champions|europa league|conference league|premier league|la ?liga|bundesliga|ligue 1|coppa|supercoppa|\bsport|tennis|\batp\b|\bwta\b|formula ?1|\bf1\b|moto ?gp|superbike|basket|\bnba\b|eurolega|volley|pallavolo|rugby|ciclismo|giro d'italia|tour de france|\bnfl\b|\bnhl\b|\bmlb\b|\bufc\b|\bboxe\b|boxing|wrestling|\bwwe\b|\bgolf\b|nuoto|atletica|olimpiad|mondiali|europei|highlights|\bvs\.?\s/i;
  function isSportItem(name, genre, tmdb) {
    if (tmdb && String(tmdb) !== '0') return false;
    return SPORT_RE.test(genre || '') || SPORT_RE.test(name || '');
  }

  function vodRootEntries() {
    var pl = activePlaylist();
    // Account Xtream con canali dall'API: film, serie e sport dall'API. Se l'API non andava (playlist completa), dalla playlist.
    if (isXtream(pl) && !(state.vodM3u && state.vodM3u.length)) {
      return [
        vodEntry({ kind: 'folder', title: 'Film', sub: 'Per categoria', icon: 'film', load: function () { return xtCats('vod', 'film'); } }),
        vodEntry({ kind: 'folder', title: 'Serie TV', sub: 'Per categoria', icon: 'film', load: function () { return xtCats('series'); } }),
        vodEntry({ kind: 'folder', title: 'Sport', sub: 'Partite e gare registrate', icon: 'trophy', load: function () { return xtCats('vod', 'sport'); } })
      ];
    }
    var byGroup = {}, order = [];
    (state.vodM3u || []).forEach(function (ch) {
      var g = ch.group || 'Altri';
      if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
      byGroup[g].push(ch);
    });
    order.sort(function (a, b) { return a.localeCompare(b); });
    function groupFolder(g) {
      return vodEntry({ kind: 'folder', cat: true, title: g, sub: byGroup[g].length + (byGroup[g].length === 1 ? ' titolo' : ' titoli'), load: function () {
        return Promise.resolve(byGroup[g].map(function (ch) {
          return vodEntry({ kind: 'play', title: cleanName(ch.name), logo: ch.logo, url: ch.url, groups: [g] });
        }));
      } });
    }
    // Categorie sportive (dal nome della categoria) raccolte in "Sport"; le altre restano com'erano.
    var sport = order.filter(function (g) { return SPORT_RE.test(g); });
    var rest = order.filter(function (g) { return !SPORT_RE.test(g); }).map(groupFolder);
    if (sport.length) {
      rest.unshift(vodEntry({ kind: 'folder', title: 'Sport', sub: sport.length + (sport.length === 1 ? ' categoria' : ' categorie'), icon: 'trophy',
        load: function () { return Promise.resolve(sport.map(groupFolder)); } }));
    }
    return rest;
  }

  // mode (solo film): 'film' = senza lo sport, 'sport' = solo lo sport. Le liste si scaricano una volta per sessione.
  function xtCats(type, mode) {
    return xtApi(type === 'vod' ? 'get_vod_categories' : 'get_series_categories').then(function (cats) {
      if (!Array.isArray(cats) || !cats.length) throw new Error('nessuna categoria');
      return cats.map(function (c) {
        var id = String(c.category_id), name = String(c.category_name || 'Altro');
        return vodEntry({ kind: 'folder', cat: true, title: name, sub: type === 'series' ? 'Serie TV' : mode === 'sport' ? 'Sport' : 'Film',
          load: function () { return xtList(type, id, name, mode); } });
      });
    });
  }

  function sportWhen(it) {
    var s = it.starts_at || it.releasedate || it.releaseDate || '';
    if (/^\d{9,11}$/.test(String(s))) { var d = new Date(+s * 1000); return isNaN(d) ? '' : d.toLocaleDateString('it-IT') + ' ' + hhmm(d.getTime()); }
    return String(s).replace('T', ' ').slice(0, 16);
  }

  // Contenuto di UNA categoria, chiesto al fornitore ogni volta che si entra (sempre aggiornato; una richiesta piccola).
  // path (solo sport): le cartelle già scelte, es. ['Calcio'] → si mostrano solo le gare di quella disciplina.
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function xtList(type, catId, catName, mode, path) {
    var x = xtreamParts(activePlaylist().url);
    var action = (type === 'vod' ? 'get_vod_streams' : 'get_series') + '&category_id=' + encodeURIComponent(catId);
    return xtApi(action).then(function (list) {
      if (!Array.isArray(list)) throw new Error('risposta non valida');
      var out = [];
      list.forEach(function (it) {
        if (!it) return;
        // i fornitori mandano anni e date come testo o come numero: tutto convertito in testo (prima un numero
        // qui faceva fallire l'intera lista dei film)
        var year = str(it.year) || str(it.releaseDate || it.releasedate || it.release_date).slice(0, 4);
        var sub = [year, it.rating ? '★ ' + str(it.rating) : ''].filter(Boolean).join('  ·  ');
        if (type === 'vod') {
          var genre = str(it.genre);
          var sport = isSportItem(str(it.name), genre, it.tmdb_id || it.tmdb);
          if ((mode === 'sport') !== sport) return;
          if (sport) sub = [genre.replace(/\s*·\s*/g, ' · '), sportWhen(it)].filter(Boolean).join('  ·  ');
          out.push(vodEntry({ kind: 'play', title: str(it.name) || 'Senza titolo', logo: str(it.stream_icon), sub: sub, groups: [catName], when: str(it.starts_at),
            // livelli dello sport dal genere: "Calcio · Serie A Enilive" → ['Calcio', 'Serie A Enilive']
            sparts: genre.split(/\s*[·•|]\s*/).filter(function (p) { return !!p; }),
            url: x.srv + '/movie/' + x.user + '/' + x.pass + '/' + encodeURIComponent(String(it.stream_id)) + '.' + xtExt(it.container_extension, 'mp4') }));
          return;
        }
        var sid = str(it.series_id), title = str(it.name) || 'Senza titolo', cover = str(it.cover);
        out.push(vodEntry({ kind: 'folder', title: title, logo: cover, sub: sub || 'Serie', load: function () { return xtSeries(sid, title, cover); } }));
      });
      if (mode !== 'sport') return out;
      path = path || [];
      var inPath = out.filter(function (e) {
        for (var k = 0; k < path.length; k++) if ((e.sparts[k] || (k === 0 ? 'Altro' : '')) !== path[k]) return false;
        return true;
      });
      return sportTree(inPath, path.length, { type: type, catId: catId, catName: catName, path: path });
    });
  }

  // Sport in cartelle dal genere del fornitore: disciplina → competizione → gare (le più recenti per prime).
  // Le gare senza livello successivo stanno accanto alle cartelle; gare senza genere in "Altro".
  // Entrando in una cartella (es. "Calcio") si richiede di nuovo la categoria al fornitore: sempre aggiornato.
  function sportTree(items, depth, ctx) {
    var groups = {}, order = [], loose = [];
    items.forEach(function (e) {
      var p = e.sparts && e.sparts[depth];
      if (!p) { if (depth === 0) p = 'Altro'; else { loose.push(e); return; } }
      if (!groups[p]) { groups[p] = []; order.push(p); }
      groups[p].push(e);
    });
    order.sort(function (a, b) { return a === 'Altro' ? 1 : b === 'Altro' ? -1 : a.localeCompare(b); });
    loose.sort(function (a, b) { return String(b.when).localeCompare(String(a.when)); });
    var folders = order.map(function (p) {
      var list = groups[p];
      return vodEntry({ kind: 'folder', cat: true, title: p, icon: 'trophy', sub: list.length + (list.length === 1 ? ' gara' : ' gare'),
        load: function () { return xtList(ctx.type, ctx.catId, ctx.catName, 'sport', ctx.path.concat([p])); } });
    });
    return folders.concat(loose);
  }

  function xtSeries(sid, title, cover) {
    var x = xtreamParts(activePlaylist().url);
    return xtApi('get_series_info&series_id=' + encodeURIComponent(sid)).then(function (info) {
      var eps = info && info.episodes ? info.episodes : {};
      var seasons = Object.keys(eps).sort(function (a, b) { return (+a || 0) - (+b || 0); });
      if (!seasons.length) throw new Error('nessun episodio');
      function episodes(sn) {
        return (eps[sn] || []).map(function (e) {
          // Numero davanti solo se il titolo non lo contiene già (es. "S01E01 - Tutti da Charlie").
          var n = e.episode_num && !/^\s*S\d+\s*E\d+/i.test(e.title || '') ? 'E' + e.episode_num + ' · ' : '';
          var img = e.info && (e.info.movie_image || e.info.cover_big) || cover;
          var dur = e.info && e.info.duration ? e.info.duration : '';
          return vodEntry({ kind: 'play', ep: true, title: n + String(e.title || 'Episodio'), logo: img, sub: dur, groups: [title + ' · Stagione ' + sn],
            url: x.srv + '/series/' + x.user + '/' + x.pass + '/' + encodeURIComponent(String(e.id)) + '.' + xtExt(e.container_extension, 'mp4') });
        });
      }
      if (seasons.length === 1) return episodes(seasons[0]);
      return seasons.map(function (sn) {
        return vodEntry({ kind: 'folder', title: 'Stagione ' + sn, logo: cover, sub: (eps[sn] || []).length + ' episodi',
          load: function () { return Promise.resolve(episodes(sn)); } });
      });
    });
  }

  // Livello mostrato: { title, entries, sel }. La radice si costruisce al primo ingresso.
  function vodLevel() {
    if (!state.vod) state.vod = { stack: [{ title: 'On demand', entries: vodRootEntries(), sel: 0 }] };
    return state.vod.stack[state.vod.stack.length - 1];
  }

  function vodRender(focusIdx) {
    var lv = vodLevel(), q = state.query.toLowerCase();
    state.filtered = q ? lv.entries.filter(function (e) { return e.title.toLowerCase().indexOf(q) >= 0; }) : lv.entries.slice();
    gridV.reset();
    $('grid-tools').classList.add('hidden');
    var path = state.vod.stack.map(function (l) { return l.title; }).join('  ›  ');
    setStatus(state.filtered.length ? path + '   ·   ' + state.filtered.length + (state.filtered.length === 1 ? ' elemento' : ' elementi') +
      (state.vod.stack.length > 1 ? '   ·   Indietro per risalire' : '') : path + '   ·   niente da mostrare');
    if (typeof focusIdx === 'number' && state.screen === 'browse') {
      var c = gridV.ensure(Math.max(0, Math.min(focusIdx, state.filtered.length - 1)));
      if (c) Nav.focus(c);
    }
  }

  function vodOpen(i) {
    var e = state.filtered[i];
    if (!e) return;
    var lv = vodLevel();
    lv.sel = lv.entries.indexOf(e);
    if (e.kind === 'play') {
      var list = state.filtered.filter(function (x) { return x.kind === 'play'; });
      state.vod.playFrom = i;
      openPlayer(list, list.indexOf(e));
      return;
    }
    var token = (state.vod.token = (state.vod.token || 0) + 1);
    setStatus('Caricamento di “' + e.title + '”…');
    // Una cartella che contiene solo un'altra cartella (es. "Film" → "La mia lista") si attraversa da sola:
    // si apre direttamente quella dentro, e nel percorso compaiono tutte e due.
    var title = e.title;
    function descend(entries) {
      if (entries.length === 1 && entries[0].kind === 'folder' && entries[0].cat) {   // solo categorie, non una serie
        title += '  ›  ' + entries[0].title;
        return entries[0].load().then(descend);
      }
      return entries;
    }
    e.load().then(descend).then(function (entries) {
      if (!state.vod || state.vod.token !== token) return;
      if (!entries.length) {
        toast(isXtream(activePlaylist()) ? 'In “' + title + '” non c\'è ancora niente. Se il fornitore ha una “La mia lista”, aggiungi i titoli dal suo sito.' :
          'In “' + title + '” non c\'è niente da guardare', 6000);
        vodRender(i);
        return;
      }
      state.query = ''; el.search.value = '';
      state.vod.stack.push({ title: title, entries: entries, sel: 0 });
      vodRender(0);
    }, function (err) {
      if (!state.vod || state.vod.token !== token) return;
      toast('Non riesco ad aprire “' + e.title + '”' + (err && err.message ? ' (' + err.message + ')' : ''), 5000);
      vodRender(i);
    });
  }

  // Indietro dentro Film e serie: risale di un livello. false se si è già alla radice.
  function vodBack() {
    if (!state.vod || state.vod.stack.length < 2) return false;
    state.vod.stack.pop();
    state.vod.token = (state.vod.token || 0) + 1;
    vodRender(vodLevel().sel);
    return true;
  }

  // Uscita dal lettore di un film: di nuovo l'elenco, sul titolo appena visto.
  function vodReturn() {
    show('browse');
    if (state.group !== '__vod') { selectGroup('__vod'); return; }
    var lv = vodLevel(), idx = lv.entries.indexOf(state.playing);
    vodRender(idx >= 0 ? idx : (state.vod.playFrom || 0));
  }

  function makeVodCard(e, i) {
    var d = document.createElement('div');
    d.className = 'card focusable vod' + (e.kind === 'folder' ? ' vfolder' : '');
    d.setAttribute('data-idx', i);
    var logo = document.createElement('div'); logo.className = 'clogo';
    if (e.logo) fillLogo(logo, e);
    else logo.innerHTML = Icons.svg(e.kind === 'folder' ? (e.icon || 'folder') : 'film');
    var name = document.createElement('div'); name.className = 'cname'; name.textContent = e.title;
    var sub = document.createElement('div'); sub.className = 'cnow'; sub.textContent = e.sub || '';
    var pos = e.kind === 'play' ? vodPos()[e.url] : 0;
    if (pos) { var b = document.createElement('div'); b.className = 'cnum'; b.textContent = 'ripreso a ' + fmtDur(pos); d.appendChild(b); }
    d.appendChild(logo); d.appendChild(name); d.appendChild(sub);
    return d;
  }

  // Posizione dei film: si riprende da dove eri rimasto (solo su questo dispositivo, ultimi 200 titoli).
  function vodPos() { return Store.get('vodPos', {}) || {}; }
  function vodSavePos() {
    var ch = state.playing, v = el.video;
    if (!ch || !ch.vod || !(v.currentTime > 0)) return;
    var all = vodPos(), dur = isFinite(v.duration) ? v.duration : 0;
    if (dur && v.currentTime > dur - 90) delete all[ch.url];           // finito (o quasi): si riparte dall'inizio
    else if (v.currentTime > 30) all[ch.url] = Math.floor(v.currentTime);
    var keys = Object.keys(all);
    if (keys.length > 200) delete all[keys[0]];
    Store.set('vodPos', all);
  }
  function vodResume() {
    state.vodResumed = true;
    var p = vodPos()[state.playing.url], v = el.video;
    if (p > 30 && (!isFinite(v.duration) || p < v.duration - 90)) {
      try { v.currentTime = p; toast('Riprendo da ' + fmtDur(p) + ' (◀ per tornare indietro)', 3500); } catch (e) { /* non si può spostare */ }
    }
  }

  // Fine di un episodio: parte il successivo della stessa stagione; fine di un film: si torna all'elenco.
  el.video.addEventListener('ended', function () {
    var ch = state.playing;
    if (state.screen !== 'player' || !ch || !ch.vod) return;
    vodSavePos();
    if (ch.ep && state.playIdx + 1 < state.playList.length) { toast('Episodio successivo…', 2500); playIndex(state.playIdx + 1); return; }
    closePlayer();
  });

  // ---------------------------------------------------------------- Lettore
  function openPlayer(list, idx) {
    state.returnFocus = Nav.current();
    state.playList = list.slice();
    show('player');
    playIndex(idx);
  }

  function closePlayer() {
    if (state.multiReturn) { returnToMulti(); return; }
    if (state.playing && state.playing.vod) vodSavePos();                // prima di fermare il video
    stopStream();
    hideOsd();
    if (state.guide) closeGuide();
    el.perr.classList.add('hidden');
    if (state.playing && state.playing.vod) { vodReturn(); return; }   // film: torna all'elenco dei film
    goHome(state.playing);
  }

  // Torna alla Home (dal lettore o dalla multivisione), con il canale appena visto nell'anteprima.
  function goHome(ch) {
    if (!activePlaylist()) { show('browse', el.search); return; }
    if (ch) state.pv.ch = ch;
    state.query = ''; el.search.value = '';
    if (state.group !== '__home') selectGroup('__home');
    show('browse', el.pvPanel);
    if (el.home.classList.contains('hidden')) applyFilter();
    else renderHome();
  }

  function focusCardFor(ch) {
    if (!ch) return null;
    for (var i = 0; i < state.filtered.length; i++) {
      if (state.filtered[i].url === ch.url) return gridV.ensure(i);
    }
    return null;
  }

  function playIndex(i) {
    var n = state.playList.length;
    if (!n) return;
    i = ((i % n) + n) % n;
    if (state.playing && state.playing.vod) vodSavePos();
    state.playIdx = i;
    state.playing = state.playList[i];
    state.stallRetries = 0;
    state.vodResumed = false;
    if (!state.playing.vod) {                                             // i film non diventano "ultimo canale"
      noteWatching(state.playing.url);
      Store.set('lastChannel', state.playing.url);
    }
    startStream(state.playing);
    showOsd(false);
  }

  // Cambio canale con su/giù o CH±: le pressioni ravvicinate si sommano e parte solo il canale finale
  // (prima ogni pressione avviava e distruggeva un lettore: tenendo premuto la TV si impuntava).
  var ZAP_DELAY = 250;
  function zap(step) {
    var n = state.playList.length;
    if (!n) return;
    var from = state.zapTarget === null ? state.playIdx : state.zapTarget;
    state.zapTarget = ((from + step) % n + n) % n;
    fillOsdChannel(state.playList[state.zapTarget], state.zapTarget);
    clearTimeout(state.timers.zap);
    state.timers.zap = setTimeout(function () {
      var t = state.zapTarget;
      state.zapTarget = null;
      if (state.screen === 'player' && t !== null && t !== state.playIdx) playIndex(t);
    }, ZAP_DELAY);
  }

  function hlsJsSupported() { return !!(window.Hls && window.Hls.isSupported()); }

  function playerLoader() {
    if (!state.loader) {
      state.loader = createLoader(el.video, {
        hls: {
          enableWorker: true,
          lowLatencyMode: false,
          // Timeshift: conserva ciò che hai già visto e continua a scaricare mentre sei in pausa.
          backBufferLength: TIMESHIFT_SECONDS,
          maxBufferLength: LIVE_AHEAD,          // mentre guardi: 30 s di anticipo (in pausa si allarga, vedi sotto)
          maxMaxBufferLength: TIMESHIFT_SECONDS,
          maxBufferSize: BUFFER_BYTES,
          fragLoadingMaxRetry: 3
        },
        onMode: function (mode, hls) { state.mode = mode; state.hls = hls; if (!hls) state.levels = []; },
        onHls: function (hls) {
          var Hls = window.Hls;
          hls.on(Hls.Events.MANIFEST_PARSED, function (ev, data) {
            state.levels = (data.levels || hls.levels || []).map(function (l, idx) { return { idx: idx, height: l.height || 0, bitrate: l.bitrate || 0 }; });
            applyQuality();
          });
          hls.on(Hls.Events.LEVEL_SWITCHED, updateQualityLabel);
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, applyTrackPrefs);
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, applyTrackPrefs);
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, updateTrackButtons);
        },
        onFail: function (msg) { if (state.screen === 'player' && state.playing) showPlayerError(msg); }
      });
    }
    return state.loader;
  }

  function startStream(ch) {
    stopStream();
    el.perr.classList.add('hidden');
    if (!/^https?:\/\//i.test(ch.url)) { showPlayerError('Indirizzo del canale non supportato (sono ammessi solo http e https).', true); return; }
    if (blockedLan(ch.url)) { showPlayerError('Questo canale punta a un dispositivo della tua rete di casa: bloccato per sicurezza.', true); return; }
    el.spinner.classList.add('on');
    state.userShift = false;
    state.levels = [];
    state.started = false; state.stallSec = 0; state.okSec = 0; state.lastTime = -1;
    state.zapStart = Date.now();
    // Prima il metodo che ha funzionato l'ultima volta con questo server (di solito hls.js: qualità e timeshift),
    // poi l'altro. Ogni tentativo ha il suo tempo limite (vedi createLoader).
    playerLoader().start(ch.url);
  }

  function tryPlay() {
    var p = el.video.play();
    if (p && p.catch) p.catch(function () { /* autoplay bloccato: l'utente può premere Play */ });
  }

  // Errore definitivo (entrambi i metodi falliti o canale che continua a bloccarsi).
  function showPlayerError(msg, plain) {
    clearTimeout(state.timers.stall);
    el.spinner.classList.remove('on');
    el.perr.querySelector('.perr-msg').textContent = plain ? msg : msg + ' Alcuni canali sono attivi solo in certi orari o paesi.';
    if (!plain && state.playing && !state.playing.vod) setDead(state.playing.url, true);
    el.perr.classList.remove('hidden');
  }

  function stopStream() {
    clearTimeout(state.timers.stall);
    if (state.loader) state.loader.stop();
    el.spinner.classList.remove('on');
  }

  el.video.addEventListener('playing', function () {
    if (state.playing && !state.playing.vod) setDead(state.playing.url, false);
    if (state.playing && state.playing.vod && !state.vodResumed) vodResume();
    if (!state.started && state.zapStart) Diag.time('Cambio canale (' + (state.mode === 'hlsjs' ? 'hls.js' : 'nativo') + ')', Date.now() - state.zapStart);
    state.started = true;
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
      // Attese crescenti tra un riavvio e l'altro (subito, 3 s, 8 s): un server in difficoltà ha il tempo di riprendersi.
      var wait = [0, 3000, 8000][state.stallRetries - 1] || 8000, ch = state.playing;
      toast('Il canale si è bloccato: lo riavvio (' + state.stallRetries + '/' + STALL_RETRIES + ')…');
      state.started = false;
      clearTimeout(state.timers.stall);
      state.timers.stall = setTimeout(function () { if (state.screen === 'player' && state.playing === ch) startStream(ch); }, wait);
    } else {
      state.started = false;
      showPlayerError('Il canale continua a bloccarsi.');
    }
  }

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
    if (state.playing && state.playing.vod) return 0;                    // un film non ha una "diretta"
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
    if (state.playing && state.playing.vod) return;
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
    if (state.screen !== 'player' || !state.playing || state.playing.vod) { el.liveBadge.classList.add('hidden'); return; }
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
    if (state.playing && state.playing.vod) {                           // film: posizione e durata
      var v = el.video, dur = isFinite(v.duration) ? v.duration : 0;
      setIc(box, paused ? 'pause' : 'play', (paused ? 'In pausa · ' : '') + fmtDur(v.currentTime || 0) + (dur ? ' / ' + fmtDur(dur) : ''));
      box.classList.remove('live');
      el.osdLive.classList.add('hidden');
      setIc(el.osdPause, el.video.paused ? 'play' : 'pause');
      return;
    }
    el.osdLive.classList.remove('hidden');
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
  // Logo, numero, nome e gruppo del canale nella barra (anche del canale verso cui si sta cambiando).
  function fillOsdChannel(ch, idx) {
    if (!ch) return;
    var lg = el.osd.querySelector('.osd-logo');
    if (lg._url !== ch.url) { lg._url = ch.url; fillLogo(lg, ch); }       // il logo si ricrea solo se cambia canale
    el.osd.querySelector('.osd-num').textContent = ch.num;
    el.osd.querySelector('.osd-name').textContent = ch.title;
    el.osd.querySelector('.osd-group').textContent = ch.groups.join(' · ') + '   (' + (idx + 1) + '/' + state.playList.length + ')';
  }

  function showOsd(withFocus) {
    var ch = state.playing;
    if (!ch) return;
    if (state.zapTarget === null) fillOsdChannel(ch, state.playIdx);
    updateOsdFav();
    fillOsdEpg();
    updateQualityLabel();
    updateTrackButtons();
    el.osdPrev.classList.toggle('hidden', !state.prevUrl);
    setIc($('osd-home'), state.multiReturn ? 'multi' : 'home', state.multiReturn ? 'Multivisione' : 'Home');
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
    setIc(el.optResume, 'play', 'Anteprima in Home: ' + (state.resumeLast ? 'ultimo canale' : 'spenta'));
    setIc(el.optUpd, 'refresh', 'Controllo aggiornamenti: ' + (state.updCheck ? 'attivo' : 'disattivato'));
    setIc(el.optDead, 'warning', 'Canali non funzionanti: ' + (state.hideDead ? 'nascosti' : 'visibili (attenuati)'));
    var pm = Store.get('perfMode', 'auto');
    setIc($('opt-perf'), 'quality', 'Prestazioni: ' + (pm === 'auto' ? 'automatiche (' + PERF_NAMES[PERF.auto] + ')' : PERF_NAMES[+pm]));
  }

  function updateMultiPrefLabel() {
    var b = el.multiPref;
    if (!b) return;
    setIc(b, 'multi', 'Multivisione, riquadri: ' + (state.multiPref ? state.multiPref : 'automatico (' + deviceTiles() + ')'));
  }

  // Canale dall'indirizzo: indice costruito al caricamento della playlist (prima scorreva tutta la lista ogni volta).
  function channelByUrl(url) {
    if (state.byUrlFor !== state.channels) {
      state.byUrl = {};
      for (var i = state.channels.length - 1; i >= 0; i--) state.byUrl['u:' + state.channels[i].url] = state.channels[i];
      state.byUrlFor = state.channels;
    }
    return state.byUrl['u:' + url] || null;
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
    if (toBrowse !== false) goHome(null);
  }

  function tileStop(i) {
    var t = state.multi.tiles[i];
    if (t.loader) t.loader.stop();
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

  // Errore definitivo del riquadro (il caricatore ha già provato entrambi i metodi).
  function tileFail(i, msg) {
    var m = state.multi; if (!m) return;
    var t = m.tiles[i];
    if (tileTvLimit(i)) return;
    t.el.classList.remove('loading');
    var err = t.el.querySelector('.tile-err');
    err.textContent = msg;
    if (t.ch && !/riprodurre un altro video/.test(msg)) setDead(t.ch.url, true); // limite della TV, non colpa del canale
    err.classList.remove('hidden');
  }

  // TV con un solo decoder: se un altro riquadro sta già andando, il problema è la TV, non il canale.
  function tileTvLimit(i) {
    var m = state.multi;
    if (state.multiSingle || !(platform === 'webos' || platform === 'tizen')) return false;
    if (!m.tiles.some(function (o, j) { return j !== i && o.played; })) return false;
    enableSingleVideo();
    return true;
  }

  function tileLoader(t) {
    if (!t.loader) {
      // Riquadri piccoli: qualità limitata alla dimensione del riquadro e buffer ridotto (meno memoria e rete).
      // liveMaxLatency/maxLiveSyncPlaybackRate: se il riquadro resta indietro, hls.js lo riporta in diretta da solo.
      t.loader = createLoader(t.video, {
        hls: { capLevelToPlayerSize: true, startLevel: 0, maxBufferLength: 12, maxMaxBufferLength: 20,
          liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 7, maxLiveSyncPlaybackRate: 1.15,
          backBufferLength: 0, maxBufferSize: 20 * 1000 * 1000, fragLoadingMaxRetry: 2 },
        onMode: function (mode, hls) { t.mode = mode; t.hls = hls; },
        onPlaying: function () { t.el.classList.remove('loading'); t.played = true; },
        // Sulle TV il primo fallimento di un secondo riquadro è quasi sempre il limite del decoder: niente secondo tentativo.
        onFirstFail: function () { return tileTvLimit(+t.el.getAttribute('data-i')); },
        onFail: function (msg) {
          var i = +t.el.getAttribute('data-i');
          tileFail(i, /non risponde/.test(msg) && i > 0 && (platform === 'tizen' || platform === 'webos') ?
            'La TV non riesce a riprodurre un altro video insieme' : msg.replace(/\.$/, ''));
        }
      });
    }
    return t.loader;
  }

  function tileLoad(i, ch) {
    var m = state.multi;
    var t = m.tiles[i];
    tileStop(i);
    t.ch = ch;
    t.el.classList.remove('empty');
    t.el.classList.add('loading');
    t.el.querySelector('.tile-err').classList.add('hidden');
    t.el.querySelector('.tl-num').textContent = ch.num;
    t.el.querySelector('.tl-name').textContent = ch.title;
    fillTileEpg(t);
    showTileLabel(i);
    t.el.classList.remove('standby');
    if (state.multiSingle && i !== m.focus) { tileStandby(i); updateTileAudio(); return; }
    if (!/^https?:\/\//i.test(ch.url)) { tileFail(i, 'Indirizzo non supportato'); return; }
    if (blockedLan(ch.url)) { tileFail(i, 'Bloccato: punta alla rete di casa'); return; }
    tileLoader(t).start(ch.url);
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
      if (t.hls) {
        try {
          t.hls.capLevelToPlayerSize = i === m.focus;
          t.hls.autoLevelCapping = i === m.focus ? -1 : 0;
        } catch (e) { /* versione di hls.js senza queste opzioni */ }
      }
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
        if (cur && cur.classList.contains('mhome')) { closeMulti(); return true; }
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
  function addPlaylistUrl(name, url, type) {
    var p = null;
    state.playlists.forEach(function (x) { if (x.url === url) p = x; });
    if (p && type && p.type !== type) { p.type = type; saveCustomPlaylists(); }
    if (!p) {
      p = { id: 'u' + Date.now(), name: name || 'Playlist personale', url: url, type: type || 'm3u', preset: false };
      state.playlists.push(p);
      saveCustomPlaylists();
    }
    state.activeId = p.id; Store.set('activePlaylist', p.id);
    state.group = '__all';
    loadActive();
    renderPlaylists();
    return p;
  }

  function usePlaylistId(id) {
    state.activeId = id;
    Store.set('activePlaylist', state.activeId);
    state.group = '__all'; state.query = ''; el.search.value = '';
    loadActive();
    renderPlaylists();
  }

  function deletePlaylistId(id) {
    state.playlists = state.playlists.filter(function (p) { return p.id !== id; });
    saveCustomPlaylists();
    Cache.remove('cache:' + id);
    Cache.remove('epg:' + id);
    if (state.activeId === id) { state.activeId = state.playlists.length ? state.playlists[0].id : ''; Store.set('activePlaylist', state.activeId); loadActive(); }
    renderPlaylists();
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
    if (window.Pair && !window.qrcode && !state.qrTried) {               // libreria del QR caricata solo quando serve
      state.qrTried = true;
      loadLib('vendor/qrcode.js').then(openPair, openPair);
      return;
    }
    if (!window.Pair || !window.qrcode) { toast('Funzione non disponibile su questo dispositivo'); return; }
    closePair();
    var code;
    try { code = Pair.newCode(); } catch (e) { toast('Funzione non disponibile su questo dispositivo'); return; }
    var p = state.pair = { code: code, keys: null, since: Math.floor(Date.now() / 1000) - 10, last: '', seen: {}, es: null, timer: null };
    el.pair.querySelector('.pair-code').textContent = Pair.formatCode(code);
    el.pair.querySelector('.pair-url').textContent = SEND_URL.replace(/^https:\/\//, '').replace(/\/$/, '');
    el.pair.querySelector('.pair-log').innerHTML = '';
    el.pair.querySelector('.pair-qr').innerHTML = '';
    pairStatus('Preparo il codice…');
    p.back = Nav.current();                                             // dove rimettere il cursore alla chiusura
    el.pair.classList.remove('hidden');
    Nav.focus($('pair-close'));                                         // OK chiude: il pulsante si vede selezionato
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
      if (state.pair === p) { closePair(); toast('Codice scaduto: riapri "Dal telefono o dal PC" se ti serve'); }
    }, PAIR_MINUTES * 60e3);
  }

  function closePair() {
    var p = state.pair;
    if (!p) return;
    state.pair = null;
    clearTimeout(p.timer); clearTimeout(p.expire);
    if (p.es) { try { p.es.close(); } catch (e) { /* ignora */ } }
    el.pair.classList.add('hidden');
    // Il cursore torna dov'era; se quell'elemento non c'è più (la pagina è stata ridisegnata), sul primo della schermata.
    var back = p.back;
    if (!back || !document.body.contains(back) || !back.offsetParent) {
      back = state.screen === 'settings' ? el.screens.settings.querySelector('.focusable') : (firstMainItem() || activeGroupEl());
    }
    if (back) Nav.focus(back);
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
    if (!d || d.from === 'tv') return;                                  // non è per noi, è stato alterato o l'ha mandato la TV
    if (pairCommand(p, d)) return;
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
      var pl = addPlaylistUrl(name, d.url, 'm3u');
      setIc(line, 'check', 'Playlist aggiunta e attivata: ' + pl.name);
    } else return;
    pairLog(line);
    pairSend(p, pairState());                                           // il telefono vede subito l'elenco aggiornato
  }

  function pairLog(line) {
    var log = el.pair.querySelector('.pair-log');
    log.appendChild(line);
    while (log.children.length > 4) log.removeChild(log.firstChild);
    pairStatus('Fatto! Puoi continuare dal telefono con lo stesso codice, oppure premi OK per tornare indietro.');
  }

  // Elenco per il telefono: solo id, nomi e stato. Mai indirizzi, utenti o password (e comunque tutto cifrato).
  function pairState() {
    return {
      t: 'state', from: 'tv',
      pl: state.playlists.slice(0, 20).map(function (x) {
        return { i: x.id, n: String(x.name || '').slice(0, 40), x: isXtream(x) ? 1 : 0, a: x.id === state.activeId ? 1 : 0, f: x.preset ? 1 : 0 };
      }),
      epg: state.epgSources.slice(0, 10).map(function (x) {
        return { i: x.id, n: String(x.name || '').slice(0, 40), o: x.on !== false ? 1 : 0, f: x.preset ? 1 : 0 };
      })
    };
  }

  function pairSend(p, obj) {
    if (!p.keys || state.pair !== p) return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', Pair.RELAY + p.keys.topic);
      xhr.send(Pair.encrypt(p.keys, obj));
    } catch (e) { /* il telefono può richiedere l'elenco */ }
  }

  // Comandi dal telefono: elenco, usa/elimina una playlist, attiva/elimina una guida. true se era un comando.
  function pairCommand(p, d) {
    var t = d.t, id = typeof d.id === 'string' ? d.id : '';
    if (t === 'list') { pairSend(p, pairState()); return true; }
    if (t !== 'use' && t !== 'del' && t !== 'epgOn' && t !== 'epgDel') return false;
    var pl = null, src = null, msg = '';
    state.playlists.forEach(function (x) { if (x.id === id) pl = x; });
    state.epgSources.forEach(function (x) { if (x.id === id) src = x; });
    if (t === 'use' && pl) {
      usePlaylistId(id);
      msg = 'Playlist attivata: ' + pl.name;
    } else if (t === 'del' && pl && !pl.preset) {
      deletePlaylistId(id);
      msg = 'Playlist eliminata: ' + pl.name;
    } else if (t === 'epgOn' && src) {
      src.on = !!d.on;
      saveEpgSources(); renderEpgSources(); loadEpg(true);
      msg = 'Guida ' + (src.on ? 'attivata: ' : 'disattivata: ') + src.name;
    } else if (t === 'epgDel' && src && !src.preset) {
      state.epgSources = state.epgSources.filter(function (x) { return x.id !== id; });
      saveEpgSources(); renderEpgSources(); loadEpg(true);
      msg = 'Guida eliminata: ' + src.name;
    }
    if (msg) {
      var line = document.createElement('div');
      line.className = 'pair-item';
      setIc(line, 'check', msg);
      pairLog(line);
    }
    pairSend(p, pairState());                                           // anche se era già cambiato: l'elenco aggiornato
    return true;
  }

  function openPicker(onPick, fixedList, selIdx, title) {
    var favs = fixedList ? [] : favChannels();
    var rest = fixedList || state.channels.filter(function (c) { return !state.favorites[c.url]; });
    // Tutti i canali (prima al massimo 3000: con playlist grandi gli altri non si raggiungevano); la lista è
    // "a finestra", quindi aprirla sul canale 2500 non crea più 2500 righe in un colpo.
    var list = favs.concat(rest);
    state.picker = { list: list, sel: 0, onPick: onPick, favCount: favs.length };
    el.picker.querySelector('.guide-ch').textContent = title || 'Scegli un canale';
    el.picker.classList.remove('hidden');
    pickV.reset();
    pickerSelect(selIdx > 0 && selIdx < list.length ? selIdx : 0);
  }

  // Una riga della lista canali (i preferiti, in cima, hanno la stella).
  function makePickerRow(i) {
    var p = state.picker, ch = p.list[i];
    var r = document.createElement('div');
    r.className = 'pk-row' + (state.dead[ch.url] ? ' dead' : '') + (i === p.sel ? ' sel' : '');
    r.setAttribute('data-i', i);
    var num = document.createElement('span'); num.className = 'pk-num'; num.textContent = ch.num;
    var nm = document.createElement('span'); nm.className = 'pk-name'; nm.textContent = (i < p.favCount ? '★ ' : '') + ch.title;
    var nn = EPG.nowNext(ch.epg, Date.now());
    var nw = document.createElement('span'); nw.className = 'pk-now'; nw.textContent = nn.now ? nn.now[2] : '';
    r.appendChild(num); r.appendChild(nm); r.appendChild(nw);
    return r;
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

  function pickerSelect(i) {
    var p = state.picker;
    var prev = el.pickerList.querySelector('.pk-row.sel');
    if (prev) prev.classList.remove('sel');
    p.sel = Math.max(0, Math.min(i, p.list.length - 1));
    var row = pickV.ensure(p.sel);
    if (row) { row.classList.add('sel'); if (row.scrollIntoViewIfNeeded) row.scrollIntoViewIfNeeded(false); else row.scrollIntoView({ block: 'nearest' }); }
  }

  function closePicker() { pickV.clear(); state.picker = null; el.picker.classList.add('hidden'); }

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
    showDiag: function () {
      var box = $('diag');
      var lines = ['BTV ' + APP_VERSION + ' · ' + platform + ' · aperta da ' + Math.round((Date.now() - Diag.start) / 60000) + ' min'];
      var ps = Store.get('perf', {}) || {};
      lines.push('Prestazioni: ' + PERF_NAMES[PERF.tier] + (PERF.mode === 'auto' ? ' (automatiche)' : ' (scelte a mano; automatiche: ' + PERF_NAMES[PERF.auto] + ')') +
        ' · massimo per questo dispositivo: ' + PERF_NAMES[PERF.spec] + ' · memoria dichiarata: ' + (PERF.mem ? PERF.mem + ' GB' : 'n.d.') +
        ' · processori: ' + (PERF.cores || 'n.d.') + ' · prova fluidità: ' + (ps.frameTest || 'non ancora') + ' · scatti durante l\'uso: ' + perfSlowCount);
      var mem = window.performance && performance.memory;
      if (mem) lines.push('Memoria JavaScript: ' + Math.round(mem.usedJSHeapSize / 1048576) + ' MB (limite ' + Math.round(mem.jsHeapSizeLimit / 1048576) + ' MB)');
      lines.push('Elementi nella pagina: ' + document.getElementsByTagName('*').length + ' · canali: ' + state.channels.length +
        ' · con guida: ' + state.epgCount + ' · metodo per server ricordato: ' + Object.keys(streamModes).length);
      lines.push('');
      Diag.items.slice().reverse().forEach(function (d) {
        var t = new Date(d.at);
        lines.push(pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()) + '  ' + d.label + ': ' + d.ms + ' ms');
      });
      if (!Diag.items.length) lines.push('Nessuna misura ancora.');
      box.textContent = lines.join('\n');
      // Finestra sopra lo schermo (prima il riquadro si apriva in fondo alle Impostazioni, fuori vista sulla TV).
      state.diagOpen = true;
      box.scrollTop = 0;
      $('diag-panel').classList.remove('hidden');
    },
    // Schede "Account Xtream Codes" / "Playlist M3U": si vede un solo modulo alla volta.
    addTab: function (b) { showAddTab(b.getAttribute('data-tab')); },
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
      usePlaylistId(b.getAttribute('data-id'));
      Nav.setRoot(el.screens.settings, el.plList.querySelector('.pl-row.current .btn'));
      toast('Playlist attiva: ' + activePlaylist().name);
    },
    deletePlaylist: function (b) {
      deletePlaylistId(b.getAttribute('data-id'));
      Nav.setRoot(el.screens.settings, null);
      toast('Playlist eliminata');
    },
    openPair: function () { openPair(); },
    toggleReorder: function () { if (state.reorder) stopReorder(); else startReorder(); },
    previewFull: function () {
      var ch = state.pv.ch;
      if (!ch) return;
      var i = state.channels.indexOf(ch);
      previewStop();
      openPlayer(state.channels, i < 0 ? 0 : i);
    },
    homePlay: function (b) {
      var ch = channelByUrl(b.getAttribute('data-url'));
      if (!ch) return;
      var i = state.channels.indexOf(ch);
      previewStop();
      openPlayer(state.channels, i < 0 ? 0 : i);
    },
    homeGroup: function (b) {
      selectGroup(b.getAttribute('data-group'));
      Nav.focus(firstMainItem() || activeGroupEl());
    },
    installUpdate: function () { checkUpdate(true, installUpdate); },   // prima rilegge l'ultima versione: il riquadro può essere vecchio
    resetTvUpdate: function () {
      Store.remove('webBundle');
      toast('Torno alla versione installata: riavvio BTV…', 3000);
      setTimeout(function () { location.reload(); }, 1500);
    },
    // Automatiche → Leggero → Normale → Completo → Automatiche. Si applica riavviando BTV.
    cyclePerf: function () {
      var order = ['auto', '0', '1', '2'], cur = Store.get('perfMode', 'auto');
      var next = order[(order.indexOf(cur) + 1) % order.length];
      Store.set('perfMode', next);
      updateOptLabels();
      clearTimeout(state.timers.perf);
      state.timers.perf = setTimeout(function () { toast('Riavvio BTV con le nuove prestazioni…', 2500); setTimeout(function () { location.reload(); }, 1200); }, 2500);
      toast('Prestazioni: ' + (next === 'auto' ? 'automatiche' : PERF_NAMES[+next]) + ' · si applicano tra poco (premi ancora per cambiare)', 2500);
    },
    toggleUpdCheck: function () {
      state.updCheck = !state.updCheck; Store.set('updCheck', state.updCheck); updateOptLabels();
      if (state.updCheck) checkUpdate(true); else showUpdateBox(null);
    },
    openLogin: function () { openSettings(); showAddTab('xt'); Nav.setRoot(el.screens.settings, $('xt-server')); $('xt-server').scrollIntoView(); },
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
      addPlaylistUrl(name, url, 'm3u');
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
    if (target.classList.contains('card')) {
      if (state.group === '__vod') { vodOpen(+target.getAttribute('data-idx')); return; }
      openPlayer(state.filtered, +target.getAttribute('data-idx'));
      return;
    }
    if (target.classList.contains('group')) {
      clearTimeout(state.timers.group);
      selectGroup(target.getAttribute('data-group'));
      var fm = firstMainItem(); if (fm) Nav.focus(fm);
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
    if (state.group === '__vod' && vodBack()) return;                     // Film e serie: un livello indietro
    if (c && c.classList.contains('card')) { Nav.focus(activeGroupEl()); return; }
    if (activePlaylist() && state.group !== '__home') { selectGroup('__home'); Nav.focus(el.pvPanel); return; }
    var now = Date.now();
    if (now - state.lastBack < 2500) { exitApp(); return; }
    state.lastBack = now;
    toast('Premi di nuovo Indietro per uscire');
  }

  function handleAction(a) {
    if (!a) return false;
    if (state.pair) { if (a === 'back' || a === 'enter') closePair(); return true; }
    if (state.diagOpen) {
      var db = $('diag');
      if (a === 'up' || a === 'down' || a === 'chup' || a === 'chdown') db.scrollTop += (a === 'up' || a === 'chup' ? -1 : 1) * 160;
      else if (a === 'back' || a === 'enter') closeDiag();
      return true;
    }
    if (state.picker && a.indexOf('digit') !== 0) return pickerAction(a);
    if (state.reorder && state.screen === 'browse' && reorderKey(a)) return true; // i numeri restano "vai al canale N"
    if (state.guide) { if (guideAction(a)) return true; }
    if (state.screen === 'multi' && a.indexOf('digit') !== 0) return multiAction(a);
    if (a === 'back') { handleBack(); return true; }
    if (a.indexOf('digit') === 0) { if (state.screen !== 'settings') { typeDigit(a.slice(5)); return true; } return false; }

    if (state.screen === 'player') {
      // Frecce e OK con la barra nascosta: la prima pressione apre solo la barra con tutte le opzioni,
      // l'azione (cambio canale, spostamento, conferma) arriva dalla pressione successiva.
      // I tasti dedicati (CH+/CH−, colori, play, numeri) agiscono subito.
      var osdOn = osdVisible() && Nav.current() && el.osd.contains(Nav.current());
      if (!osdOn && (a === 'up' || a === 'down' || a === 'left' || a === 'right' || a === 'enter')) {
        showOsd(false);
        Nav.setRoot(el.osd, behindLive() ? el.osdLive : el.osdPause);
        showOsd(true);
        return true;
      }
      switch (a) {
        case 'up': zap(1); showOsd(true); return true;
        case 'down': zap(-1); showOsd(true); return true;
        case 'chup': zap(1); return true;
        case 'chdown': zap(-1); return true;
        case 'rw': seekBy(-SEEK_STEP); return true;
        case 'ff': seekBy(SEEK_STEP); return true;
        case 'left': case 'right': Nav.move(a); showOsd(true); return true;   // barra aperta: muovi tra i pulsanti
        case 'live': goLive(); return true;
        case 'enter': activate(Nav.current()); return true;
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
          if (cur && cur.classList.contains('card') && state.group !== '__vod') { openGuide(state.filtered, +cur.getAttribute('data-idx')); return true; }
        }
        return false;
      case 'chup': case 'chdown':
        if (state.screen === 'browse') { for (var i = 0; i < 3; i++) Nav.move(a === 'chup' ? 'up' : 'down'); return true; }
        return false;
    }
    return false;
  }

  // ---------------------------------------------------------------- Fluidità (per il livello di prestazioni)
  // 1) Prova breve 8 s dopo l'avvio: per 1,5 s si contano i fotogrammi in ritardo (> 50 ms). Se sono troppi, il
  //    massimo livello per questo dispositivo scende di uno dal prossimo avvio.
  // 2) Durante l'uso (fuori dal lettore): se tra la pressione di un tasto e il disegno passano più di 300 ms per
  //    5 volte, dal prossimo avvio si scende di un livello. Mai si sale per questo: solo si scende (prudenza).
  var perfSlowCount = 0, perfSlowSaved = false;
  function perfSave(patch) {
    var ps = Store.get('perf', {}) || {};
    for (var k in patch) ps[k] = patch[k];
    Store.set('perf', ps);
  }
  function nextFrame(fn) { (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(fn); }
  if (!PERF.web) {
    setTimeout(function () {
      if (background || state.screen === 'player' || !window.requestAnimationFrame) return;
      var last = 0, frames = 0, late = 0, end = Date.now() + 1500;
      (function tick(t) {
        if (last) { frames++; if (t - last > 50) late++; }
        last = t;
        if (Date.now() < end) { nextFrame(tick); return; }
        var janky = frames > 10 && late / frames > 0.15;
        perfSave({ janky: janky, frameTest: late + ' in ritardo su ' + frames });
        Diag.time('Prova di fluidità: fotogrammi in ritardo su ' + frames, late);
      })(0);
    }, 8000);
    document.addEventListener('keydown', function (e) {
      if (e.repeat || perfSlowSaved || state.screen === 'player' || Date.now() - Diag.start < 20000) return;
      var t0 = Date.now();
      nextFrame(function () {
        nextFrame(function () {
          var d = Date.now() - t0;
          if (d <= 300) return;
          perfSlowCount++;
          Diag.time('Tasto lento a rispondere', d);
          // Scende di un livello e non risale più da solo (niente su e giù tra due livelli).
          if (perfSlowCount >= 5 && PERF.mode === 'auto') { perfSlowSaved = true; perfSave({ slow: true, cap: Math.max(0, PERF.tier - 1) }); }
        });
      });
    }, true);
  }

  // ---------------------------------------------------------------- Eventi
  // Ogni tasto (o clic/tocco) riazzera il minuto di attesa prima dello schermo intero automatico.
  document.addEventListener('keydown', armIdle, true);
  document.addEventListener('mousedown', armIdle, true);
  document.addEventListener('touchstart', armIdle, true);
  var lastPtr = '';
  document.addEventListener('mousemove', function (e) {               // puntatore del telecomando LG (solo se si muove davvero)
    var pos = e.screenX + ',' + e.screenY;
    if (pos !== lastPtr) { lastPtr = pos; armIdle(); }
  }, true);
  armIdle();
  var lastKeyAt = 0;
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var ae = document.activeElement;
    // Tasto tenuto premuto: le ripetizioni troppo ravvicinate si saltano (le TV lente accumulavano ritardo).
    var t = Date.now();
    if (e.repeat && t - lastKeyAt < 70) { e.preventDefault(); return; }
    lastKeyAt = t;
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
    if (state.diagOpen) { closeDiag(); return; }
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
      if (cl('.mhome')) { closeMulti(); return; }
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
  // In pausa la diretta continua a scaricarsi (fino al limite del timeshift) per riprendere senza buchi;
  // mentre guardi basta un piccolo anticipo: meno rete e meno lavoro per la TV.
  el.video.addEventListener('pause', function () { if (state.hls) state.hls.config.maxBufferLength = TIMESHIFT_SECONDS; });
  el.video.addEventListener('play', function () { if (state.hls) state.hls.config.maxBufferLength = LIVE_AHEAD; });
  ['pause', 'play', 'seeked'].forEach(function (ev) {
    el.video.addEventListener(ev, function () { if (osdVisible()) updateShift(); });
  });

  // ---------------------------------------------------------------- Avvio
  Icons.hydrate();
  $('side-ver').textContent = 'Versione ' + APP_VERSION;
  updateClock();
  Nav.setCustom(customNav);
  registerTvKeys();
  document.body.classList.add('platform-' + platform);
  if (LOW_POWER) document.body.classList.add('low-power');            // TV e Fire TV: niente effetti pesanti
  window.BTV = { state: state };                                     // utile per il debug dalla console
  setInterval(function () { refreshEpgViews(true); }, 60000);
  setInterval(function () { updateClock(); refreshHome(); }, 30000);                                    // "in onda" aggiornato ogni minuto
  setInterval(function () {
    if (state.screen === 'player' && state.playing && !el.video.paused && ++state.watchTick >= 30) {
      state.watchTick = 0;
      if (state.playing.vod) vodSavePos(); else addWatch(state.playing.url, 30);
    }
    if (state.screen === 'player') { if (osdVisible()) updateShift(); updateLiveBadge(); playerWatchdog(); }
    else el.liveBadge.classList.add('hidden');
    if (state.screen === 'multi' && state.multi) { updateTileLive(); if (!background) tileWatchdog(); }
  }, 1000);
  show('browse', el.search);
  loadActive();
  setTimeout(function () { checkUpdate(true); }, 4000);                   // all'avvio
  // L'aggiornamento scaricato sulla TV è "riuscito" solo dopo il primo caricamento vero (playlist mostrata o
  // benvenuto): se si blocca prima, al prossimo avvio boot.js torna da solo alla versione installata.
  // Rete di sicurezza: dopo 60 s senza errori lo si considera comunque riuscito (es. rete assente all'avvio).
  setTimeout(function () { markBootOk(true); }, 60000);
})();

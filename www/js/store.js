/* Persistenza locale (localStorage) con protezione da errori/quota piena. */
var Store = (function () {
  'use strict';
  function get(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? def : JSON.parse(v);
    } catch (e) {
      return def;
    }
  }
  // Memoria piena: elimina le copie di playlist e guida (si riscaricano da sole) e libera spazio
  // per i dati che non si possono ricostruire (preferiti, playlist aggiunte, impostazioni).
  function freeSpace(keep) {
    var drop = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k !== keep && /^(cache|epg):/.test(k)) drop.push(k);
      }
    } catch (e) { return false; }
    drop.forEach(remove);
    return drop.length > 0;
  }
  function set(key, value) {
    var s;
    try { s = JSON.stringify(value); } catch (e) { return false; }
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        localStorage.setItem(key, s);
        return true;
      } catch (e) {
        if (attempt > 0 || !freeSpace(key)) break;
      }
    }
    return false;
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignora */ }
  }
  return { get: get, set: set, remove: remove };
})();

/* Copie grandi (playlist, guida TV) in IndexedDB: molto più spazio di localStorage (5-10 MB in tutto, che una
 * playlist grande riempiva da sola, facendo cancellare anche la guida) e lettura senza bloccare l'interfaccia.
 * Se IndexedDB non c'è o non funziona, ripiega su localStorage. Tutte le funzioni ritornano una Promise. */
var Cache = (function () {
  'use strict';
  var DB = 'btv-cache', OS = 'kv', dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB assente')); return; }
      var r;
      try { r = window.indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      r.onupgradeneeded = function () { r.result.createObjectStore(OS); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('IndexedDB')); };
      r.onblocked = function () { reject(new Error('IndexedDB bloccato')); };
    });
    dbp.then(migrate, function () { /* niente IndexedDB: si usa localStorage */ });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(OS, mode), req = fn(t.objectStore(OS));
        t.oncomplete = function () { resolve(req && req.result); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('IndexedDB')); };
      });
    });
  }
  function get(key) {
    // Se non c'è ancora in IndexedDB può essere una copia vecchia in localStorage (migrazione in corso).
    return tx('readonly', function (s) { return s.get(key); }).then(function (v) { return v === undefined ? Store.get(key, null) : v; },
      function () { return Store.get(key, null); });
  }
  function set(key, value) {
    return tx('readwrite', function (s) { return s.put(value, key); }).then(function () { return true; },
      function () { return Store.set(key, value); });
  }
  function remove(key) {
    return tx('readwrite', function (s) { return s['delete'](key); }).then(function () { Store.remove(key); },
      function () { Store.remove(key); });
  }
  // Una volta sola: le copie salvate dalle versioni precedenti in localStorage passano in IndexedDB.
  function migrate(db) {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^(cache|epg):/.test(k)) keys.push(k); }
    } catch (e) { return; }
    keys.forEach(function (k) {
      var v = Store.get(k, null);
      if (!v) { Store.remove(k); return; }
      var t = db.transaction(OS, 'readwrite');
      t.objectStore(OS).put(v, k);
      t.oncomplete = function () { Store.remove(k); };
    });
  }
  open();   // apertura subito (a freddo può richiedere qualche centinaio di ms): pronta quando serve la playlist
  return { get: get, set: set, remove: remove };
})();

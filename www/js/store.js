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

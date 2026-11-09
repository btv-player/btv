/*
 * Guida TV (EPG) in formato XMLTV.
 * - parse(): estrae canali e programmi (solo nella finestra temporale utile)
 * - match(): collega i canali della playlist ai canali della guida
 *   (tvg-id, nome normalizzato, ID Pluto TV contenuto in URL/logo)
 */
var EPG = (function () {
  'use strict';

  var PAST = 2 * 3600e3;     // tieni i programmi finiti da meno di 2 ore
  var FUTURE = 26 * 3600e3;  // e quelli che iniziano entro 26 ore (oggi + domani mattina): meno memoria
  var DROP = { hd: 1, sd: 1, fhd: 1, uhd: 1, '4k': 1, tv: 1, channel: 1, italia: 1, italy: 1, it: 1 };

  function decode(s) {
    if (!s || s.indexOf('&') < 0) return s || '';
    return s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === 'amp') return '&';
      if (l === 'lt') return '<';
      if (l === 'gt') return '>';
      if (l === 'quot') return '"';
      if (l === 'apos') return '\'';
      var n = l.charAt(1) === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return isNaN(n) ? m : String.fromCharCode(n);
    });
  }

  function stripCdata(s) {
    return String(s || '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
  }

  // "20261108154000 +0100" -> millisecondi UTC
  function parseTime(s) {
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(s || '');
    if (!m) return NaN;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) {
      var sign = m[7].charAt(0) === '-' ? -1 : 1;
      t -= sign * (parseInt(m[7].slice(1, 3), 10) * 60 + parseInt(m[7].slice(3, 5), 10)) * 60e3;
    }
    return t;
  }

  function tag(body, name) {
    var m = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>').exec(body);
    return m ? decode(stripCdata(m[1])) : '';
  }

  function attr(head, name) {
    var m = new RegExp('\\b' + name + '="([^"]*)"').exec(head);
    return m ? decode(m[1]) : '';
  }

  // Chiavi di confronto: "Rai 1 HD.it" -> ["rai1hd", "rai1"], "Sky Uno +" -> ["skyunoplus"]
  function keys(name) {
    var s = String(name || '').toLowerCase()
      .replace(/\s{2,}\d+\s*$/, '')   // "Rai 1 HD  101" (numero canale in coda)
      .replace(/@.*$/, '')
      .replace(/\.[a-z]{2}$/, '')
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\+/g, ' plus ')
      .replace(/&/g, ' and ')
      .replace(/[àáâä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i').replace(/[òóôö]/g, 'o').replace(/[ùúûü]/g, 'u');
    var tokens = s.split(/[^a-z0-9]+/).filter(Boolean);
    var full = tokens.join('');
    var short = tokens.filter(function (t) { return !DROP[t]; }).join('');
    var out = [];
    if (full) out.push(full);
    if (short && short !== full) out.push(short);
    return out;
  }

  function hexIds(s) {
    return String(s || '').match(/[0-9a-f]{24}/g) || [];
  }

  // Ritorna { channels: {id: {names:[], icon}}, progs: {id: [[start, stop, title, desc, category], ...]} }
  function parse(xml, now) {
    now = now || Date.now();
    var from = now - PAST, to = now + FUTURE;
    var channels = {}, progs = {};
    var m;

    var reCh = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
    while ((m = reCh.exec(xml))) {
      var id = attr(m[1], 'id');
      if (!id) continue;
      var names = [];
      var reName = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g, n;
      while ((n = reName.exec(m[2]))) names.push(decode(stripCdata(n[1])));
      var icon = /<icon\b[^>]*src="([^"]*)"/.exec(m[2]);
      channels[id] = { names: names, icon: icon ? decode(icon[1]) : '' };
    }

    var reP = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    while ((m = reP.exec(xml))) {
      var start = parseTime(attr(m[1], 'start'));
      var stop = parseTime(attr(m[1], 'stop'));
      if (isNaN(start)) continue;
      if (isNaN(stop)) stop = start + 3600e3;
      if (stop < from || start > to) continue;
      var ch = attr(m[1], 'channel');
      var desc = tag(m[2], 'desc');
      if (desc.length > 280) desc = desc.slice(0, 277) + '…';
      (progs[ch] || (progs[ch] = [])).push([start, stop, tag(m[2], 'title') || 'Senza titolo', desc, tag(m[2], 'category')]);
    }
    Object.keys(progs).forEach(function (id) {
      if (!channels[id]) channels[id] = { names: [id], icon: '' };
      progs[id].sort(function (a, b) { return a[0] - b[0]; });
    });
    return { channels: channels, progs: progs };
  }

  // Collega ogni canale della playlist (ch.epg = lista programmi). Ritorna quanti canali hanno la guida.
  function match(playlist, guides) {
    var byKey = {}, byHex = {};
    guides.forEach(function (g) {
      Object.keys(g.channels).forEach(function (id) {
        var list = g.progs[id];
        if (!list || !list.length) return;
        var c = g.channels[id];
        [id].concat(c.names).forEach(function (name) {
          keys(name).forEach(function (k) { if (!byKey[k]) byKey[k] = list; });
        });
        hexIds(id + ' ' + c.icon).forEach(function (h) { if (!byHex[h]) byHex[h] = list; });
      });
    });
    var found = 0;
    playlist.forEach(function (ch) {
      var list = null;
      var hex = hexIds(ch.url + ' ' + ch.logo);
      for (var i = 0; i < hex.length && !list; i++) list = byHex[hex[i]] || null;
      var cand = keys(ch.tvgId).concat(keys(ch.title || ch.name));
      for (var j = 0; j < cand.length && !list; j++) list = byKey[cand[j]] || null;
      ch.epg = list;
      if (list) found++;
    });
    return found;
  }

  // Indice del programma in onda in una lista ordinata (-1 se nessuno).
  function currentIndex(list, now) {
    if (!list) return -1;
    now = now || Date.now();
    for (var i = 0; i < list.length; i++) {
      if (list[i][0] <= now && list[i][1] > now) return i;
      if (list[i][0] > now) return -1;
    }
    return -1;
  }

  function nowNext(list, now) {
    now = now || Date.now();
    var i = currentIndex(list, now);
    var next = null;
    if (list) {
      for (var j = Math.max(0, i); j < list.length; j++) if (list[j][0] > now) { next = list[j]; break; }
    }
    return { now: i >= 0 ? list[i] : null, next: next };
  }

  // Versione compatta per la cache: solo i programmi dei canali usati dalla playlist.
  function compact(guides, playlist) {
    var used = [];
    playlist.forEach(function (ch) { if (ch.epg && used.indexOf(ch.epg) < 0) used.push(ch.epg); });
    var out = { channels: {}, progs: {} };
    guides.forEach(function (g) {
      Object.keys(g.progs).forEach(function (id) {
        if (used.indexOf(g.progs[id]) >= 0 && !out.progs[id]) {
          out.progs[id] = g.progs[id];
          out.channels[id] = g.channels[id];
        }
      });
    });
    return out;
  }

  // Bytes della guida -> testo. Se è gzip la decompressione si ferma oltre MAX_XML (protegge da file "bomba").
  var MAX_XML = 160 * 1024 * 1024;
  function toText(bytes, pk) {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (!pk) throw new Error('gzip non supportato');
      var inf = new pk.Inflate(), parts = [], total = 0;
      inf.onData = function (chunk) {
        total += chunk.length;
        if (total > MAX_XML) throw new Error('guida troppo grande');
        parts.push(chunk);
      };
      inf.push(bytes, true);
      if (inf.err) throw new Error(inf.msg || 'gzip non valido');
      var out = new Uint8Array(total), off = 0;
      for (var i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
      bytes = out;
    }
    if (bytes.length > MAX_XML) throw new Error('guida troppo grande');
    return new TextDecoder('utf-8').decode(bytes);
  }

  return { toText: toText, parse: parse, match: match, nowNext: nowNext, currentIndex: currentIndex, compact: compact, keys: keys, parseTime: parseTime };
})();
if (typeof module !== 'undefined') module.exports = EPG;

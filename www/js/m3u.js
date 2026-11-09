/* Parser di playlist M3U / M3U8 estese (#EXTINF con attributi tvg-*). */
var M3U = (function () {
  'use strict';
  var ATTR = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

  // Divide "#EXTINF:-1 attr="a,b",Titolo" in intestazione e titolo,
  // ignorando le virgole dentro le virgolette.
  function splitInfo(line) {
    var s = line.slice(8);
    var inQuote = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"') inQuote = !inQuote;
      else if (c === ',' && !inQuote) return { head: s.slice(0, i), title: s.slice(i + 1).trim() };
    }
    return { head: s, title: '' };
  }

  function splitGroups(g) {
    var out = [];
    (g || '').split(';').forEach(function (x) {
      x = x.trim();
      if (x && out.indexOf(x) < 0) out.push(x);
    });
    if (!out.length) out.push('Altri');
    return out;
  }

  function parse(text) {
    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    var cur = null;
    out.epgUrls = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) continue;
      if (l.indexOf('#EXTM3U') === 0) {
        // Guida TV indicata dalla playlist: url-tvg="a.xml,b.xml.gz" oppure x-tvg-url="…"
        var h = /(?:url-tvg|x-tvg-url)="([^"]*)"/i.exec(l);
        if (h) h[1].split(',').forEach(function (u) { u = u.trim(); if (/^https?:\/\//i.test(u)) out.epgUrls.push(u); });
      } else if (l.indexOf('#EXTINF') === 0) {
        var p = splitInfo(l);
        var a = {};
        var m;
        ATTR.lastIndex = 0;
        while ((m = ATTR.exec(p.head))) a[m[1].toLowerCase()] = m[2];
        cur = {
          name: p.title || a['tvg-name'] || 'Senza nome',
          logo: a['tvg-logo'] || '',
          group: a['group-title'] || '',
          tvgId: a['tvg-id'] || '',
          chno: a['tvg-chno'] || '',
          groupLogo: a['group-logo'] || ''   // raro: logo della categoria, se la playlist lo indica
        };
      } else if (l.indexOf('#EXTGRP:') === 0) {
        if (cur && !cur.group) cur.group = l.slice(8).trim();
      } else if (l.charAt(0) === '#') {
        continue;
      } else if (/^(https?|rtmp|rtsp|udp):\/\//i.test(l)) {
        var ch = cur || { name: l, logo: '', group: '', tvgId: '', chno: '' };
        ch.url = l;
        ch.groups = splitGroups(ch.group);
        out.push(ch);
        cur = null;
      }
    }
    return out;
  }

  return { parse: parse };
})();

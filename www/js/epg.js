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

  // Espressioni compilate una volta sola (prima se ne creava una nuova per ogni tag di ogni programma).
  var RE_TAG = {
    title: /<title\b[^>]*>([\s\S]*?)<\/title>/,
    desc: /<desc\b[^>]*>([\s\S]*?)<\/desc>/,
    category: /<category\b[^>]*>([\s\S]*?)<\/category>/
  };
  var RE_ATTR = {
    id: /\bid="([^"]*)"/,
    start: /\bstart="([^"]*)"/,
    stop: /\bstop="([^"]*)"/,
    channel: /\bchannel="([^"]*)"/
  };

  function tag(body, name) {
    var m = RE_TAG[name].exec(body);
    return m ? decode(stripCdata(m[1])) : '';
  }

  function attr(head, name) {
    var m = RE_ATTR[name].exec(head);
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

  // Analisi a pezzi: il testo arriva un blocco alla volta (mentre si decomprime) e si tengono in memoria solo
  // i programmi utili, mai l'intero file. push(testo) più volte, poi finish().
  // Ritorna { channels: {id: {names:[], icon}}, progs: {id: [[start, stop, title, desc, category], ...]} }
  var RE_NAME = /<display-name\b[^>]*>([^<]*(?:<(?!\/display-name>)[^<]*)*)<\/display-name>/g;
  var RE_ICON = /<icon\b[^>]*src="([^"]*)"/;
  var KEEP_TAIL = 16;          // fine del blocco che potrebbe contenere l'inizio spezzato di un tag ("<progr")
  var MAX_PENDING = 2 * 1024 * 1024;   // un elemento più lungo di così è malformato: lo si salta

  function Parser(now) {
    now = now || Date.now();
    this.from = now - PAST; this.to = now + FUTURE;
    this.channels = {}; this.progs = {};
    this.buf = ''; this.broken = false;
  }

  function isBoundary(c) { return c === ' ' || c === '>' || c === '\t' || c === '\n' || c === '\r'; }

  // Prossimo elemento <channel> o <programme> a partire da pos: {a, name} oppure null.
  function nextOpen(s, pos) {
    while (true) {
      var a = s.indexOf('<', pos);
      if (a < 0) return null;
      if (s.charAt(a + 1) === 'p' && s.substr(a, 10) === '<programme' && isBoundary(s.charAt(a + 10))) return { a: a, name: 'programme' };
      if (s.charAt(a + 1) === 'c' && s.substr(a, 8) === '<channel' && isBoundary(s.charAt(a + 8))) return { a: a, name: 'channel' };
      // inizio di tag spezzato a fine blocco: va completato dal blocco successivo
      if (s.length - a < 12) return { a: a, name: '' };
      pos = a + 1;
    }
  }

  Parser.prototype.push = function (text) {
    if (this.broken) return this;
    var s = this.buf ? this.buf + text : text, pos = 0, keep = -1;
    while (true) {
      var o = nextOpen(s, pos);
      if (!o) break;
      if (!o.name) { keep = o.a; break; }
      var h = s.indexOf('>', o.a);
      if (h < 0) { keep = o.a; break; }
      var close = '</' + o.name + '>';
      var z = s.indexOf(close, h);
      if (z < 0) { keep = o.a; break; }                    // elemento non ancora completo: aspetta il resto
      var head = s.slice(o.a + o.name.length + 1, h), body = s.slice(h + 1, z);
      if (o.name === 'programme') this.programme(head, body); else this.channel(head, body);
      pos = z + close.length;
    }
    if (keep >= 0) {
      this.buf = s.slice(keep);
      if (this.buf.length > MAX_PENDING) {                 // elemento senza chiusura: il resto del file non è valido
        this.buf = ''; this.broken = true;
      }
    } else {
      this.buf = s.length - pos > KEEP_TAIL ? s.slice(s.length - KEEP_TAIL) : s.slice(pos);
    }
    return this;
  };

  Parser.prototype.channel = function (head, body) {
    var id = attr(head, 'id');
    if (!id) return;
    var names = [], n;
    RE_NAME.lastIndex = 0;
    while ((n = RE_NAME.exec(body))) names.push(decode(stripCdata(n[1])));
    var icon = RE_ICON.exec(body);
    this.channels[id] = { names: names, icon: icon ? decode(icon[1]) : '' };
  };

  Parser.prototype.programme = function (head, body) {
    var start = parseTime(attr(head, 'start'));
    var stop = parseTime(attr(head, 'stop'));
    if (isNaN(start)) return;
    if (isNaN(stop)) stop = start + 3600e3;
    if (stop < this.from || start > this.to) return;
    var ch = attr(head, 'channel');
    var desc = tag(body, 'desc');
    if (desc.length > 280) desc = desc.slice(0, 277) + '…';
    var progs = this.progs;
    (progs[ch] || (progs[ch] = [])).push([start, stop, tag(body, 'title') || 'Senza titolo', desc, tag(body, 'category')]);
  };

  Parser.prototype.finish = function () {
    var channels = this.channels, progs = this.progs;
    this.buf = '';
    Object.keys(progs).forEach(function (id) {
      if (!channels[id]) channels[id] = { names: [id], icon: '' };
      progs[id].sort(function (a, b) { return a[0] - b[0]; });
    });
    return { channels: channels, progs: progs };
  };

  function parse(xml, now) { return new Parser(now).push(xml).finish(); }

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
      // Chiavi del canale calcolate una volta sola (match si ripete per ogni fonte della guida).
      if (!ch._mk) ch._mk = { hex: hexIds(ch.url + ' ' + ch.logo), cand: keys(ch.tvgId).concat(keys(ch.title || ch.name)) };
      var hex = ch._mk.hex, cand = ch._mk.cand;
      for (var i = 0; i < hex.length && !list; i++) list = byHex[hex[i]] || null;
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
  // Lineare: le liste usate vengono segnate (prima indexOf dentro un ciclo su tutti i canali: costo quadratico,
  // decine di milioni di confronti con qualche migliaio di canali).
  var compactStamp = 0;
  function compact(guides, playlist) {
    var stamp = 'c' + (++compactStamp) + '_' + Date.now();
    playlist.forEach(function (ch) { if (ch.epg) ch.epg._used = stamp; });
    var out = { channels: {}, progs: {} };
    guides.forEach(function (g) {
      Object.keys(g.progs).forEach(function (id) {
        var list = g.progs[id];
        if (list._used === stamp && !out.progs[id]) {
          out.progs[id] = list;
          out.channels[id] = g.channels[id];
        }
      });
    });
    return out;
  }

  // Dai byte (gzip o no) ai programmi, un blocco alla volta: decompressione, decodifica e analisi procedono
  // insieme e in memoria restano solo i programmi utili (prima: tutto il file decompresso più una copia come testo,
  // centinaia di MB per una guida grande). La decompressione si ferma oltre MAX_XML (protegge da file "bomba").
  var MAX_XML = 160 * 1024 * 1024;
  var SLICE = 1024 * 1024;

  function Feeder(pk, now) {
    this.pk = pk; this.parser = new Parser(now); this.total = 0; this.inf = null; this.gz = null;
    this.dec = new TextDecoder('utf-8');
  }
  Feeder.prototype.text = function (bytes) {
    this.total += bytes.length;
    if (this.total > MAX_XML) throw new Error('guida troppo grande');
    this.parser.push(this.dec.decode(bytes, { stream: true }));
  };
  // Un pezzo di file (Uint8Array). last = true sull'ultimo.
  Feeder.prototype.push = function (bytes, last) {
    var self = this;
    if (this.gz === null) {
      if (!bytes.length && !last) return;
      this.gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
      if (this.gz) {
        if (!this.pk) throw new Error('gzip non supportato');
        this.inf = new this.pk.Inflate();
        this.inf.onData = function (chunk) { self.text(chunk); };
      }
    }
    if (this.gz) {
      this.inf.push(bytes, !!last);
      if (this.inf.err) throw new Error(this.inf.msg || 'gzip non valido');
    } else {
      for (var i = 0; i < bytes.length; i += SLICE) this.text(bytes.subarray(i, Math.min(bytes.length, i + SLICE)));
    }
  };
  Feeder.prototype.finish = function () {
    this.parser.push(this.dec.decode());
    return this.parser.finish();
  };

  // Tutto il file in un colpo (byte già scaricati): analisi comunque a blocchi.
  function parseBytes(bytes, pk, now) {
    var f = new Feeder(pk, now);
    f.push(bytes, true);
    return f.finish();
  }

  // Compatibilità: byte -> testo intero (solo per file piccoli, es. nei test).
  function toText(bytes, pk) {
    var parts = [], f = new Feeder(pk, 0);
    f.parser = { push: function (t) { parts.push(t); }, finish: function () {} };
    f.push(bytes, true);
    parts.push(f.dec.decode());
    return parts.join('');
  }

  return { toText: toText, parse: parse, parseBytes: parseBytes, Feeder: Feeder, Parser: Parser, match: match, nowNext: nowNext,
    currentIndex: currentIndex, compact: compact, keys: keys, parseTime: parseTime };
})();
if (typeof module !== 'undefined') module.exports = EPG;

// Test dei parser di playlist (M3U) e guida TV (XMLTV), senza dipendenze: node test/run.js
// I dati sono inventati (nessuna playlist o guida reale).
'use strict';
const assert = require('assert');
const zlib = require('zlib');
const path = require('path');
const M3U = require(path.join(__dirname, '..', 'www', 'js', 'm3u.js'));
const EPG = require(path.join(__dirname, '..', 'www', 'js', 'epg.js'));
const pako = require('pako');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}

// ---------------------------------------------------------------- dati di prova
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
function xt(t) {                                   // ms -> "YYYYMMDDhhmmss +0000"
  const d = new Date(t), p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00 +0000';
}
function sampleXml(nCh, perCh) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="test">'];
  for (let c = 0; c < nCh; c++) {
    out.push('<channel id="ch' + c + '.it"><display-name lang="it">Canale ' + c + ' HD</display-name>' +
      '<display-name>C' + c + '</display-name><icon src="http://logo.example/' + c + '.png"/></channel>');
  }
  for (let c = 0; c < nCh; c++) {
    for (let i = 0; i < perCh; i++) {
      const s = NOW - 6 * 3600e3 + i * 1800e3;          // da 6 ore fa, ogni mezz'ora (una parte fuori finestra)
      out.push('<programme start="' + xt(s) + '" stop="' + xt(s + 1800e3) + '" channel="ch' + c + '.it">' +
        '<title lang="it">Prog ' + i + ' &amp; c&#232;</title>' +
        '<desc><![CDATA[Descrizione <b>' + i + '</b> del canale ' + c + ']]></desc>' +
        '<category>Cat' + (i % 3) + '</category></programme>');
    }
  }
  out.push('</tv>');
  return out.join('\n');
}

// ---------------------------------------------------------------- M3U
console.log('M3U');
test('attributi, virgole tra virgolette, EXTGRP, guide della playlist', () => {
  const txt = '#EXTM3U url-tvg="http://g.example/a.xml,https://g.example/b.xml.gz"\n' +
    '#EXTINF:-1 tvg-id="rai1.it" tvg-logo="http://l/1.png" tvg-chno="5" group-title="Gen;News",Rai 1, HD\n' +
    'http://s.example/1.m3u8\n' +
    '#EXTINF:-1,Senza gruppo\n#EXTGRP:Sport\nhttps://s.example/2.ts\n' +
    '#EXTINF:-1,Non valido\nftp://s.example/3\n' +
    'http://s.example/4\n';
  const l = M3U.parse(txt);
  assert.strictEqual(l.length, 3);
  assert.deepStrictEqual(l.epgUrls, ['http://g.example/a.xml', 'https://g.example/b.xml.gz']);
  assert.strictEqual(l[0].name, 'Rai 1, HD');
  assert.strictEqual(l[0].tvgId, 'rai1.it');
  assert.strictEqual(l[0].chno, '5');
  assert.deepStrictEqual(l[0].groups, ['Gen', 'News']);
  assert.deepStrictEqual(l[1].groups, ['Sport']);
  assert.strictEqual(l[2].name, 'http://s.example/4');
  assert.deepStrictEqual(l[2].groups, ['Altri']);
});
test('playlist grande (20.000 canali) in tempi ragionevoli', () => {
  const lines = ['#EXTM3U'];
  for (let i = 0; i < 20000; i++) lines.push('#EXTINF:-1 tvg-id="c' + i + '" group-title="G' + (i % 50) + '",Canale ' + i, 'http://s.example/' + i + '.m3u8');
  const t = Date.now();
  const l = M3U.parse(lines.join('\n'));
  assert.strictEqual(l.length, 20000);
  assert.ok(Date.now() - t < 2000, 'troppo lento: ' + (Date.now() - t) + ' ms');
});

// ---------------------------------------------------------------- Guida
console.log('Guida TV');
const XML = sampleXml(40, 80);
const whole = EPG.parse(XML, NOW);

test('analisi: canali, finestra temporale, entità, CDATA', () => {
  assert.strictEqual(Object.keys(whole.channels).length, 40);
  const p = whole.progs['ch0.it'];
  assert.ok(p.length > 0 && p.length < 80, 'finestra temporale non applicata');
  assert.ok(p.every((x) => x[1] >= NOW - 2 * 3600e3 && x[0] <= NOW + 26 * 3600e3));
  assert.strictEqual(p[0][2].indexOf('& cè') > 0, true);
  assert.ok(/^Descrizione <b>/.test(p[0][3]));
  assert.deepStrictEqual(whole.channels['ch3.it'].names, ['Canale 3 HD', 'C3']);
  assert.strictEqual(whole.channels['ch3.it'].icon, 'http://logo.example/3.png');
  for (let i = 1; i < p.length; i++) assert.ok(p[i][0] >= p[i - 1][0], 'non ordinati');
});

test('a pezzi (testo) = tutto insieme, con tagli in punti casuali', () => {
  for (let run = 0; run < 25; run++) {
    const ps = new EPG.Parser(NOW);
    let pos = 0;
    while (pos < XML.length) { const n = 1 + Math.floor(Math.random() * (run < 5 ? 7 : 5000)); ps.push(XML.slice(pos, pos + n)); pos += n; }
    assert.deepStrictEqual(ps.finish(), whole);
  }
});

test('a pezzi (byte, anche gzip) = tutto insieme, caratteri UTF-8 spezzati inclusi', () => {
  const raw = Buffer.from(XML, 'utf8');
  const gz = zlib.gzipSync(raw);
  [raw, gz].forEach((buf) => {
    assert.deepStrictEqual(EPG.parseBytes(new Uint8Array(buf), pako, NOW), whole);
    const f = new EPG.Feeder(pako, NOW);
    for (let i = 0; i < buf.length; i += 997) f.push(new Uint8Array(buf.subarray(i, Math.min(buf.length, i + 997))), false);
    f.push(new Uint8Array(0), true);
    assert.deepStrictEqual(f.finish(), whole);
  });
});

test('file malformato: si tengono i programmi fino al punto rotto, senza bloccarsi', () => {
  const bad = XML.slice(0, XML.length / 2) + '<programme start="x" channel="z"><title>senza fine';
  const t = Date.now();
  const g = EPG.parse(bad, NOW);
  assert.ok(Object.keys(g.progs).length > 0);
  assert.ok(Date.now() - t < 1000);
});

test('gzip "bomba": fermato oltre il limite', () => {
  const big = zlib.gzipSync(Buffer.alloc(170 * 1024 * 1024, 32));
  assert.throws(() => EPG.parseBytes(new Uint8Array(big), pako, NOW), /troppo grande/);
});

test('abbinamento canali e copia compatta', () => {
  const pl = [
    { name: 'Canale 3 HD', title: 'Canale 3', url: 'http://s/3', logo: '', tvgId: 'ch3.it' },
    { name: 'C7', title: 'C7', url: 'http://s/7', logo: '', tvgId: '' },
    { name: 'Nessuno', title: 'Nessuno', url: 'http://s/x', logo: '', tvgId: '' }
  ];
  assert.strictEqual(EPG.match(pl, [whole]), 2);
  assert.strictEqual(pl[0].epg, whole.progs['ch3.it']);
  assert.strictEqual(pl[1].epg, whole.progs['ch7.it']);
  const c = EPG.compact([whole], pl);
  assert.deepStrictEqual(Object.keys(c.progs).sort(), ['ch3.it', 'ch7.it']);
});

test('copia compatta lineare: 8000 canali sotto i 300 ms', () => {
  const g = { channels: {}, progs: {} }, pl = [];
  for (let i = 0; i < 8000; i++) {
    g.channels['c' + i] = { names: ['N' + i], icon: '' };
    g.progs['c' + i] = [[NOW, NOW + 1, 't', '', '']];
    pl.push({ epg: g.progs['c' + i] });
  }
  const t = Date.now();
  const c = EPG.compact([g], pl);
  assert.strictEqual(Object.keys(c.progs).length, 8000);
  assert.ok(Date.now() - t < 300, 'troppo lento: ' + (Date.now() - t) + ' ms');
});

console.log('\n' + passed + ' ok, ' + failed + ' falliti');
process.exit(failed ? 1 : 0);

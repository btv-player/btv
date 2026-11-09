/*
 * "Invia dal telefono o dal PC": la TV mostra un codice (e un QR); il telefono/PC cifra playlist o guida
 * con una chiave derivata dal codice e la invia tramite ntfy.sh (servizio gratuito di messaggi).
 * ntfy vede solo testo cifrato: senza il codice, mostrato solo sullo schermo della TV, non si legge niente.
 *
 * Schema (solo primitive standard, in JS puro: funziona anche sulle TV del 2017 senza WebCrypto):
 *   codice  = 12 caratteri casuali (60 bit) da un alfabeto senza caratteri ambigui
 *   master  = SHA-256 iterato 4096 volte su "btv-pair-v1|" + codice   (rallenta chi prova a indovinare)
 *   topic   = "btv_" + HMAC(master, "topic")[0..20]  (canale ntfy: non rivela il codice)
 *   cifrat. = keystream HMAC(encKey, nonce||contatore) XOR testo; tag = HMAC(macKey, nonce||cifrato)  (encrypt-then-MAC)
 * Usato da js/app.js (ricezione sulla TV) e da invia/index.html (invio).
 */
var Pair = (function () {
  'use strict';
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var RELAY = 'https://ntfy.sh/';
  var VERSION = 'BTV1';

  // ---------- SHA-256 (FIPS 180-4) su array di byte
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

  function sha256(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length, bitLen = l * 8;
    var n = ((l + 9 + 63) >> 6) << 6;
    var m = new Array(n), i, j;
    for (i = 0; i < n; i++) m[i] = 0;
    for (i = 0; i < l; i++) m[i] = bytes[i];
    m[l] = 0x80;
    m[n - 4] = (bitLen >>> 24) & 255; m[n - 3] = (bitLen >>> 16) & 255; m[n - 2] = (bitLen >>> 8) & 255; m[n - 1] = bitLen & 255;
    m[n - 5] = Math.floor(l / 0x20000000) & 255;
    var w = new Array(64);
    for (i = 0; i < n; i += 64) {
      for (j = 0; j < 16; j++) w[j] = (m[i + j * 4] << 24) | (m[i + j * 4 + 1] << 16) | (m[i + j * 4 + 2] << 8) | m[i + j * 4 + 3];
      for (j = 16; j < 64; j++) {
        var x = w[j - 15], y = w[j - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
    return out;
  }

  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    var ik = [], ok = [], i;
    for (i = 0; i < 64; i++) { var k = key[i] || 0; ik.push(k ^ 0x36); ok.push(k ^ 0x5c); }
    return sha256(ok.concat(sha256(ik.concat(msg))));
  }

  // ---------- conversioni
  function utf8(s) {
    s = unescape(encodeURIComponent(s));
    var b = [];
    for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i));
    return b;
  }
  function fromUtf8(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return decodeURIComponent(escape(s));
  }
  function hex(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64(b) {
    var s = '', i;
    for (i = 0; i < b.length; i += 3) {
      var n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      s += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) +
        (i + 1 < b.length ? B64.charAt((n >> 6) & 63) : '') + (i + 2 < b.length ? B64.charAt(n & 63) : '');
    }
    return s;
  }
  function unb64(s) {
    var b = [], bits = 0, acc = 0, i, v;
    for (i = 0; i < s.length; i++) {
      v = B64.indexOf(s.charAt(i));
      if (v < 0) throw new Error('base64');
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; b.push((acc >> bits) & 255); }
    }
    return b;
  }

  function randomBytes(n) {
    var g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    var out = [], i, c = g.crypto || g.msCrypto;
    if (c && c.getRandomValues) {
      var a = new Uint8Array(n); c.getRandomValues(a);
      for (i = 0; i < n; i++) out.push(a[i]);
    } else {
      throw new Error('generatore casuale sicuro non disponibile');   // niente codici prevedibili
    }
    return out;
  }

  // ---------- codice e chiavi
  function newCode() {
    var r = randomBytes(12), s = '';
    for (var i = 0; i < 12; i++) s += ALPHABET.charAt(r[i] & 31);
    return s;
  }
  function normCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function formatCode(c) { return c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8, 12); }
  function validCode(c) {
    if (c.length !== 12) return false;
    for (var i = 0; i < c.length; i++) if (ALPHABET.indexOf(c.charAt(i)) < 0) return false;
    return true;
  }

  function keys(code) {
    var m = sha256(utf8('btv-pair-v1|' + code));
    for (var i = 0; i < 4096; i++) m = sha256(m);
    return {
      topic: 'btv_' + hex(hmac(m, utf8('topic'))).slice(0, 40),
      enc: hmac(m, utf8('enc')),
      mac: hmac(m, utf8('mac'))
    };
  }

  function stream(k, nonce, len) {
    var out = [], ctr = 0;
    while (out.length < len) {
      out = out.concat(hmac(k.enc, nonce.concat([(ctr >>> 24) & 255, (ctr >>> 16) & 255, (ctr >>> 8) & 255, ctr & 255])));
      ctr++;
    }
    return out;
  }

  function encrypt(k, obj) {
    var pt = utf8(JSON.stringify(obj));
    var nonce = randomBytes(16), ks = stream(k, nonce, pt.length), ct = [];
    for (var i = 0; i < pt.length; i++) ct.push(pt[i] ^ ks[i]);
    var tag = hmac(k.mac, nonce.concat(ct)).slice(0, 16);
    return [VERSION, b64(nonce), b64(ct), b64(tag)].join('.');
  }

  // Ritorna l'oggetto, oppure null se il messaggio non è stato cifrato con questo codice o è stato alterato.
  function decrypt(k, text) {
    try {
      var p = String(text || '').split('.');
      if (p.length !== 4 || p[0] !== VERSION) return null;
      var nonce = unb64(p[1]), ct = unb64(p[2]), tag = unb64(p[3]);
      if (nonce.length !== 16 || tag.length !== 16 || ct.length > 3000) return null;
      var want = hmac(k.mac, nonce.concat(ct)).slice(0, 16), diff = 0, i;
      for (i = 0; i < 16; i++) diff |= want[i] ^ tag[i];
      if (diff) return null;
      var ks = stream(k, nonce, ct.length), pt = [];
      for (i = 0; i < ct.length; i++) pt.push(ct[i] ^ ks[i]);
      return JSON.parse(fromUtf8(pt));
    } catch (e) {
      return null;
    }
  }

  return {
    RELAY: RELAY, newCode: newCode, normCode: normCode, formatCode: formatCode, validCode: validCode,
    keys: keys, encrypt: encrypt, decrypt: decrypt, _sha256: sha256, _hex: hex, _hmac: hmac, _utf8: utf8
  };
})();
if (typeof module !== 'undefined') module.exports = Pair;

// Genera le icone PNG di BTV (senza dipendenze).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Logo BTV: "B" bianca e spessa (icona) o scritta "BTV" (banner e avvio) su sfondo sfumato corallo → magenta.
// Lettere disegnate con forme geometriche in un riquadro alto 1 (niente font), antialiasing 4x4 campioni per pixel.
const T = 0.2; // spessore del tratto
function dShape(x, y, y0, y1, xr) { // forma a "D": rettangolo + semicerchio a destra
  if (y < y0 || y > y1 || x < 0) return false;
  const R = (y1 - y0) / 2, xc = xr - R, yc = y0 + R;
  return x <= xc || (x - xc) * (x - xc) + (y - yc) * (y - yc) <= R * R;
}
function bowl(x, y, y0, y1, xr) {
  return dShape(x, y, y0, y1, xr) && !(x >= T && dShape(x - T, y, y0 + T, y1 - T, xr - 2 * T));
}
function seg(x, y, ax, ay, bx, by) { // distanza punto-segmento
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
const GLYPHS = {
  B: { w: 0.7, inside: (x, y) => bowl(x, y, 0, 0.56, 0.62) || bowl(x, y, 0.36, 1, 0.7) },
  T: { w: 0.64, inside: (x, y) => (y >= 0 && y <= T && x >= 0 && x <= 0.64) || (y >= 0 && y <= 1 && Math.abs(x - 0.32) <= T / 2) },
  V: { w: 0.74, inside: (x, y) => y >= 0 && y <= 1 && x >= 0 && x <= 0.74 &&
       (seg(x, y, 0.1, 0, 0.37, 0.92) <= T * 0.55 || seg(x, y, 0.64, 0, 0.37, 0.92) <= T * 0.55) }
};
function textInside(word, size, gap) { // funzione (x,y) in coordinate relative al centro
  const ws = word.split('').map(c => GLYPHS[c].w);
  const total = ws.reduce((a, b) => a + b, 0) + gap * (word.length - 1);
  return (x, y) => {
    const u = x / size + total / 2, v = y / size + 0.5;
    let off = 0;
    for (let i = 0; i < word.length; i++) {
      if (u >= off && u <= off + ws[i]) return GLYPHS[word[i]].inside(u - off, v);
      off += ws[i] + gap;
    }
    return false;
  };
}
function draw(w, h, { radius = 0.2, rounded = true, word = 'B', scale = 0.56 } = {}) {
  const s = Math.min(w, h);
  const rr = rounded ? s * radius : 0;
  const inside = (x, y) => {
    if (!rounded) return true;
    const dx = Math.max(rr - x, 0, x - (w - rr)), dy = Math.max(rr - y, 0, y - (h - rr));
    return dx * dx + dy * dy <= rr * rr;
  };
  const glyph = textInside(word, s * scale, 0.12);
  return png(w, h, (x, y) => {
    let bg = 0, fg = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const sx = x + (i + 0.5) / 4, sy = y + (j + 0.5) / 4;
      if (inside(sx, sy)) { bg++; if (glyph(sx - w / 2, sy - h / 2)) fg++; }
    }
    const t = Math.min(1, Math.max(0, (x / w * 0.6 + y / h * 0.4)));
    const r = 255 + (196 - 255) * t, g = 106 + (32 - 106) * t, b = 61 + (156 - 61) * t;
    const f = fg / 16;
    return [Math.round(r + (255 - r) * f), Math.round(g + (255 - g) * f), Math.round(b + (255 - b) * f), Math.round(255 * bg / 16)];
  });
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const files = {
  'icon-512.png': draw(512, 512),
  'icon-192.png': draw(192, 192),
  'icon-130.png': draw(130, 130),
  'icon-80.png': draw(80, 80),
  'banner-320x180.png': draw(320, 180, { rounded: false, word: 'BTV', scale: 0.4 }),
  'splash-1920x1080.png': draw(1920, 1080, { rounded: false, word: 'BTV', scale: 0.22 })
};
for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(out, name), buf);
fs.copyFileSync(path.join(out, 'icon-192.png'), path.join(__dirname, '..', 'www', 'icon.png'));
console.log('Icone generate in assets/:', Object.keys(files).join(', '));

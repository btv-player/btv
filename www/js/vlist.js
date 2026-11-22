/*
 * Lista "a finestra" per elenchi lunghi (griglia dei canali, guida della Home, lista canali sopra il video):
 * nel DOM restano solo le righe vicine a quelle visibili; le altre sono sostituite da due spaziatori della stessa
 * altezza, così lo scorrimento resta naturale. Prima le righe si aggiungevano scorrendo e non si toglievano mai:
 * con migliaia di canali DOM e loghi crescevano per tutta la sessione.
 * Tutti gli elementi devono avere la stessa dimensione (righe uniformi; nella griglia card uguali).
 *   var v = new VList(box, { count: fn, make: fn(i) -> elemento, cols: 1 | 'auto', buffer: righe in più });
 *   v.reset()  v.clear()  v.ensure(i) -> elemento  v.el(i)  v.index(elemento)  v.forEach(fn(el, i))  v.refresh()  v.cols()
 */
var VList = (function () {
  'use strict';

  function spacer() {
    var s = document.createElement('div');
    s.className = 'vspace';
    s.style.cssText = 'width:100%;flex:0 0 100%;height:0;margin:0;padding:0;border:0;pointer-events:none';
    return s;
  }

  function VList(box, o) {
    this.box = box; this.o = o; this.items = {}; this.first = 0; this.last = -1;
    this.rowH = 0; this.itemW = 0; this.attached = false;
    var self = this, pending = false;
    box.addEventListener('scroll', function () {
      if (pending || !self.attached) return;
      pending = true;
      (window.requestAnimationFrame || setTimeout)(function () { pending = false; self.update(); });
    });
  }

  VList.prototype.count = function () { return this.attached ? this.o.count() : 0; };

  // Svuota (il contenitore può essere usato per altro, es. il messaggio di benvenuto).
  VList.prototype.clear = function () {
    this.box.innerHTML = '';
    this.items = {}; this.first = 0; this.last = -1; this.attached = false;
  };

  // Ricomincia dall'inizio (dati nuovi).
  VList.prototype.reset = function () {
    this.clear();
    this.top = spacer(); this.bot = spacer();
    this.box.appendChild(this.top); this.box.appendChild(this.bot);
    this.attached = true;
    this.box.scrollTop = 0;
    this.update();
  };

  VList.prototype.make = function (i) {
    var e = this.o.make(i);
    e._vi = i;
    this.items[i] = e;
    return e;
  };

  // Dimensioni di un elemento (misurate una volta sul primo, che non è selezionato).
  VList.prototype.measure = function () {
    if (this.rowH) return true;
    var e = this.items[this.first];
    if (!e) return false;
    var r = e.getBoundingClientRect(), cs = window.getComputedStyle(e);
    var h = r.height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    var w = r.width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
    if (!h) return false;
    this.rowH = h; this.itemW = w;
    return true;
  };

  VList.prototype.cols = function () {
    if (this.o.cols !== 'auto') return 1;
    if (!this.itemW) return 1;
    var cs = window.getComputedStyle(this.box);
    var w = this.box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    return Math.max(1, Math.floor((w + 1) / this.itemW));
  };

  VList.prototype.setRange = function (f, l) {
    var n = this.count(), i, frag, k;
    if (!n) { for (k in this.items) this.items[k].parentNode && this.items[k].parentNode.removeChild(this.items[k]); this.items = {}; this.first = 0; this.last = -1; this.spacers(); return; }
    f = Math.max(0, f); l = Math.min(n - 1, l);
    for (k in this.items) {
      i = +k;
      if (i < f || i > l) { var e = this.items[k]; if (e.parentNode) e.parentNode.removeChild(e); delete this.items[k]; }
    }
    // prima: elementi da aggiungere in testa (in ordine), poi in coda
    if (this.last < this.first || l < this.first || f > this.last) {
      frag = document.createDocumentFragment();
      for (i = f; i <= l; i++) frag.appendChild(this.make(i));
      this.box.insertBefore(frag, this.bot);
    } else {
      if (f < this.first) {
        frag = document.createDocumentFragment();
        for (i = f; i < this.first; i++) frag.appendChild(this.make(i));
        this.box.insertBefore(frag, this.top.nextSibling);
      }
      if (l > this.last) {
        frag = document.createDocumentFragment();
        for (i = this.last + 1; i <= l; i++) frag.appendChild(this.make(i));
        this.box.insertBefore(frag, this.bot);
      }
    }
    this.first = f; this.last = l;
    this.spacers();
  };

  VList.prototype.spacers = function () {
    if (!this.attached) return;
    var n = this.count(), c = this.cols(), h = this.rowH;
    if (!h || !n) { this.top.style.height = '0'; this.bot.style.height = '0'; return; }
    var rowsAll = Math.ceil(n / c);
    this.top.style.height = (Math.floor(this.first / c) * h) + 'px';
    this.bot.style.height = Math.max(0, (rowsAll - Math.ceil((this.last + 1) / c)) * h) + 'px';
  };

  VList.prototype.buffer = function () { return this.o.buffer || 4; };

  // Righe da tenere in base allo scorrimento attuale.
  VList.prototype.update = function () {
    if (!this.attached) return;
    var n = this.count();
    if (!n) { this.setRange(0, -1); return; }
    if (!this.rowH) {
      this.setRange(0, 0);                              // un elemento per misurare
      if (!this.measure()) { this.setRange(0, Math.min(n - 1, 59)); return; }   // non visibile ora: un blocco fisso
    }
    var c = this.cols(), h = this.rowH, b = this.buffer();
    var visRows = Math.ceil((this.box.clientHeight || h * 8) / h);
    var firstRow = Math.floor(this.box.scrollTop / h) - b;
    var lastRow = Math.floor(this.box.scrollTop / h) + visRows + b;
    this.setRange(Math.max(0, firstRow) * c, (lastRow + 1) * c - 1);
  };

  // L'elemento i, creandolo (con la finestra attorno) se serve. Lo scorrimento lo fa chi lo seleziona.
  VList.prototype.ensure = function (i) {
    var n = this.count();
    if (!this.attached || i < 0 || i >= n) return null;
    if (!this.rowH) this.update();
    if (this.items[i]) {
      // vicino al bordo della finestra: allarga in quella direzione prima di arrivarci
      var c = this.cols(), b = this.buffer() * c;
      if (i - this.first < c || this.last - i < c) {
        this.setRange(Math.min(this.first, i - b), Math.max(this.last, i + b));
        this.trim(i);
      }
      return this.items[i];
    }
    var cc = this.cols(), bb = (this.buffer() + 8) * cc;
    var row = Math.floor(i / cc) * cc;
    this.setRange(row - bb, row + bb + cc - 1);
    return this.items[i] || null;
  };

  // Non lasciare crescere la finestra oltre il necessario attorno all'elemento i.
  VList.prototype.trim = function (i) {
    var c = this.cols(), max = (this.buffer() * 2 + 14) * c;
    if (this.last - this.first <= max) return;
    var row = Math.floor(i / c) * c, half = Math.floor(max / 2 / c) * c;
    this.setRange(Math.max(0, row - half), row + half + c - 1);
  };

  VList.prototype.el = function (i) { return this.items[i] || null; };
  VList.prototype.index = function (e) { return e && typeof e._vi === 'number' ? e._vi : -1; };
  VList.prototype.forEach = function (fn) { for (var k in this.items) fn(this.items[k], +k); };

  // Ricrea gli elementi presenti (dati cambiati, es. riordino dei preferiti).
  VList.prototype.refresh = function () {
    if (!this.attached) return;
    var f = this.first, l = this.last;
    this.setRange(0, -1);
    this.setRange(f, l);
  };

  return VList;
})();

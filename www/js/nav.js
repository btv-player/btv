/*
 * Navigazione "spaziale" con le frecce del telecomando.
 * Il focus è virtuale (classe .focused) così, sulle TV, la tastiera a schermo
 * si apre solo quando l'utente preme OK su un campo di testo.
 */
var Nav = (function () {
  'use strict';
  var root = null;
  var cur = null;
  var custom = null;

  function visible(el) {
    if (!el) return false;
    // offsetParent è null anche per gli elementi "fixed" (es. Home in alto nel lettore): per loro conta solo la dimensione
    if (el.offsetParent === null && window.getComputedStyle(el).position !== 'fixed') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function list() {
    if (!root) return [];
    return Array.prototype.filter.call(root.querySelectorAll('.focusable'), visible);
  }

  function first() {
    return list()[0] || null;
  }

  function scrollTo(el) {
    if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(false);
    else el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function focus(el) {
    if (!el) return;
    if (cur && cur !== el) cur.classList.remove('focused');
    cur = el;
    el.classList.add('focused');
    scrollTo(el);
  }

  function setRoot(el, focusEl) {
    root = el;
    if (cur) cur.classList.remove('focused');
    cur = null;
    focus(focusEl && visible(focusEl) ? focusEl : first());
  }

  function gap(a1, a2, b1, b2) {
    return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));
  }

  // Trova l'elemento più vicino nella direzione richiesta.
  function geo(from, dir) {
    var r = from.getBoundingClientRect();
    var best = null;
    var bestScore = Infinity;
    list().forEach(function (el) {
      if (el === from) return;
      var o = el.getBoundingClientRect();
      var main, perp;
      if (dir === 'right') {
        if (o.left < r.right - 4) return;
        main = o.left - r.right; perp = gap(r.top, r.bottom, o.top, o.bottom);
      } else if (dir === 'left') {
        if (o.right > r.left + 4) return;
        main = r.left - o.right; perp = gap(r.top, r.bottom, o.top, o.bottom);
      } else if (dir === 'down') {
        if (o.top < r.bottom - 4) return;
        main = o.top - r.bottom; perp = gap(r.left, r.right, o.left, o.right);
      } else {
        if (o.bottom > r.top + 4) return;
        main = r.top - o.bottom; perp = gap(r.left, r.right, o.left, o.right);
      }
      // Gli elementi allineati (sulla stessa riga/colonna) hanno sempre la precedenza.
      // A destra/sinistra ci si muove solo sulla stessa riga.
      if (perp > 0 && (dir === 'left' || dir === 'right')) return;
      var score = (perp > 0 ? 1e6 : 0) + main + perp * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  // Ritorna true se il focus si è spostato.
  function move(dir) {
    if (!cur || !root || !root.contains(cur) || !visible(cur)) {
      focus(first());
      return true;
    }
    if (custom) {
      var t = custom(cur, dir);
      if (t === false) return false;
      if (t) { focus(t); return true; }
    }
    var g = geo(cur, dir);
    if (g) { focus(g); return true; }
    return false;
  }

  return {
    setRoot: setRoot,
    focus: focus,
    move: move,
    first: first,
    current: function () { return cur; },
    setCustom: function (fn) { custom = fn; }
  };
})();

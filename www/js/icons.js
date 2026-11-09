/*
 * Icone di BTV: SVG disegnati nell'app (niente emoji né font di sistema, che su molte TV LG/Samsung mancano).
 * Stile unico: griglia 24x24, tratto 2 arrotondato, colore = colore del testo (currentColor).
 *   Icons.svg('guide')            -> stringa <svg>
 *   Icons.set(el, 'guide', 'Guida') -> icona + testo (il testo viene sempre escapato)
 *   Icons.set(el, [['pause', '−0:30'], ['live', 'Diretta']]) -> più coppie icona/testo
 *   <i data-ic="guide"></i> in index.html viene sostituito da Icons.hydrate()
 */
var Icons = (function () {
  'use strict';
  var F = ' fill="currentColor" stroke="none"';

  function poly(points) {
    return 'M' + points.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join('L') + 'Z';
  }
  // Ingranaggio a 8 denti, generato: più regolare di qualsiasi disegno a mano.
  function gear() {
    var pts = [], k, a, R = 9.6, r = 7.4, d = Math.PI / 180;
    for (k = 0; k < 8; k++) {
      a = k * 45 * d;
      pts.push([12 + r * Math.cos(a - 15 * d), 12 + r * Math.sin(a - 15 * d)]);
      pts.push([12 + R * Math.cos(a - 9 * d), 12 + R * Math.sin(a - 9 * d)]);
      pts.push([12 + R * Math.cos(a + 9 * d), 12 + R * Math.sin(a + 9 * d)]);
      pts.push([12 + r * Math.cos(a + 15 * d), 12 + r * Math.sin(a + 15 * d)]);
    }
    return '<path d="' + poly(pts) + '"/><circle cx="12" cy="12" r="3"/>';
  }
  function star(filled) {
    var pts = [], i, a, rr;
    for (i = 0; i < 10; i++) {
      a = (-90 + i * 36) * Math.PI / 180; rr = i % 2 ? 4.1 : 9.4;
      pts.push([12 + rr * Math.cos(a), 12.8 + rr * Math.sin(a)]);
    }
    return '<path d="' + poly(pts) + '"' + (filled ? F : '') + '/>';
  }

  var P = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5"/>',
    multi: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/>' +
           '<rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
    two: '<rect x="2.5" y="5" width="8.5" height="14" rx="1.6"/><rect x="13" y="5" width="8.5" height="14" rx="1.6"/>',
    settings: gear(),
    play: '<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"' + F + '/>',
    pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1"' + F + '/><rect x="13.9" y="5" width="3.6" height="14" rx="1"' + F + '/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    rewind: '<path d="M11 6.5v11L3.5 12z"' + F + '/><path d="M20.5 6.5v11L13 12z"' + F + '/>',
    forward: '<path d="M13 6.5v11l7.5-5.5z"' + F + '/><path d="M3.5 6.5v11L11 12z"' + F + '/>',
    live: '<circle cx="12" cy="12" r="4.5"' + F + '/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
    dot: '<circle cx="12" cy="12" r="5"' + F + '/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1.3"' + F + '/>' +
          '<circle cx="4.5" cy="12" r="1.3"' + F + '/><circle cx="4.5" cy="17.5" r="1.3"' + F + '/>',
    previous: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4.2h4.2"/>',
    guide: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' +
           '<path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17h2M11 17h2"/>',
    quality: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    audio: '<path d="M4 9.5h3.5L12.5 5v14l-5-4.5H4z"/><path d="M16 9a4.2 4.2 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2"/>',
    subs: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 11.5h3.5M13.5 11.5H17M7 15h6M16 15h1"/>',
    star: star(false),
    starf: star(true),
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4.5v4.2h-4.2"/>',
    warning: '<path d="M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/>' +
             '<path d="M12 9.5v4"/><circle cx="12" cy="17" r="1.1"' + F + '/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    fullscreen: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
    swap: '<path d="M4 8h15M15.5 4.5L19 8l-3.5 3.5M20 16H5M8.5 12.5L5 16l3.5 3.5"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18h3"/>',
    home: '<path d="M3.5 11L12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>',
    folder: '<path d="M3 7.2A2.2 2.2 0 0 1 5.2 5H9l2 2.2h7.8A2.2 2.2 0 0 1 21 9.4v8.4a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.8z"/>',
    chevron: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
    arrow: '<path d="M4 12h15M13.5 6.5L19 12l-5.5 5.5"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    tv: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 3l3.5 4 3.5-4"/>',
    trophy: '<path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
    film: '<rect x="3.5" y="4" width="17" height="16" rx="2.2"/><path d="M8 4v16M16 4v16M3.5 9H8M3.5 15H8M16 9h4.5M16 15h4.5"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0"/><circle cx="9" cy="9.8" r="1.1"' + F + '/><circle cx="15" cy="9.8" r="1.1"' + F + '/>',
    doc: '<path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
    news: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 9h6M7 12.5h10M7 16h10M15.5 8.5h1.5v1.5h-1.5z"/>',
    radio: '<rect x="3" y="8" width="18" height="12" rx="2.5"/><path d="M7 8l10-4.5"/><circle cx="15.5" cy="14" r="2.6"/><path d="M6.5 12.5h4M6.5 15.5h4"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
    offline: '<path d="M2.5 8.8a14 14 0 0 1 6.3-3.2M12 5a14 14 0 0 1 9.5 3.8M5.5 12.2a9.5 9.5 0 0 1 3.6-2M15 10.4a9.5 9.5 0 0 1 3.5 1.8M8.8 15.4a4.6 4.6 0 0 1 6.4 0"/>' +
             '<circle cx="12" cy="19" r="1.2"' + F + '/><path d="M3.5 3.5l17 17"/>'
  };

  function svg(name) {
    return '<svg class="ic ic-' + name + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[name] || '') + '</svg>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; });
  }

  // Icona + testo dentro un elemento. Il testo arriva anche da dati esterni (nomi delle tracce audio): sempre escapato.
  function set(el, icon, text) {
    var parts = Object.prototype.toString.call(icon) === '[object Array]' ? icon : [[icon, text]];
    el.innerHTML = parts.map(function (p) {
      return (p[0] ? svg(p[0]) : '') + (p[1] !== undefined && p[1] !== '' ? '<span class="ict">' + esc(p[1]) + '</span>' : '');
    }).join('');
  }

  function hydrate(root) {
    var list = (root || document).querySelectorAll('i[data-ic]');
    Array.prototype.forEach.call(list, function (i) {
      var tmp = document.createElement('span');
      tmp.innerHTML = svg(i.getAttribute('data-ic'));
      i.parentNode.replaceChild(tmp.firstChild, i);
    });
  }

  return { svg: svg, set: set, hydrate: hydrate, esc: esc, names: Object.keys(P) };
})();

/* Foto e logo: se un'immagine non si trova in img/…, la cerca anche in CARICA_2/img/… e CARICA_3/img/…
 * (cartelle create caricando su GitHub i file a gruppi). Così le foto restano collegate in ogni caso. */
(function () {
  var ALT = ['CARICA_2/', 'CARICA_3/'];
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    var orig = el.getAttribute('data-bl-src') || (el.getAttribute('src') || '').replace(/^\.\//, '');
    if (!/^img\//.test(orig)) return;
    var n = Number(el.getAttribute('data-bl-try') || 0);
    if (n >= ALT.length) return;
    el.setAttribute('data-bl-src', orig);
    el.setAttribute('data-bl-try', String(n + 1));
    el.src = ALT[n] + orig;
  }, true);
  // immagini già fallite prima che questo script partisse
  function rescan() {
    Array.prototype.forEach.call(document.images, function (img) {
      if (img.complete && img.naturalWidth === 0 && /^(\.\/)?img\//.test(img.getAttribute('src') || '')) img.dispatchEvent(new Event('error'));
    });
  }
  document.addEventListener('DOMContentLoaded', rescan);
  window.BLImgFetch = function (url) {
    return fetch(url).then(function (r) { if (r.ok || !/^img\//.test(url)) return r;
      return fetch(ALT[0] + url).then(function (r2) { return r2.ok ? r2 : fetch(ALT[1] + url); }); });
  };
  // favicon
  window.addEventListener('load', function () {
    var l = document.querySelector('link[rel=icon]'); if (!l) return;
    var i = new Image(); i.onerror = function () { l.href = 'CARICA_2/img/brand/bl-logo.png'; }; i.src = l.getAttribute('href');
  });
})();

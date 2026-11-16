// The home page (2026-11-16): a click on a screenshot shows it big (on a computer); a click anywhere or Esc closes it. Nothing else runs.
(function () {
  'use strict';
  var z = document.getElementById('zoom'); if (!z) return;
  var img = z.querySelector('img');
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-zoom]');
    if (t && window.innerWidth >= 900) { img.src = t.currentSrc || t.src; img.alt = t.alt; z.hidden = false; document.body.classList.add('zoomed'); return; }
    if (!z.hidden) { z.hidden = true; document.body.classList.remove('zoomed'); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !z.hidden) { z.hidden = true; document.body.classList.remove('zoomed'); } });
})();

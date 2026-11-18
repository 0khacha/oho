// Shared fixture harness: simulates what a real CMP does (lock scroll, record the choice).
// Tests read window.__oho to verify what oho clicked.
(function () {
  const S = (window.__oho = { result: null, clicks: [] });
  window.ohoRecord = (kind) => {
    // "accepted" is sticky so a wrong click can never be masked by a later reject.
    if (S.result !== 'accepted') S.result = kind;
  };
  window.ohoLock = () => (document.documentElement.style.overflow = 'hidden');
  window.ohoUnlock = () => (document.documentElement.style.overflow = '');
  window.ohoClose = (el, kind) => {
    ohoRecord(kind);
    if (el) el.remove();
    ohoUnlock();
  };
  document.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest && e.target.closest('button,a,[role=button],input[type=button],input[type=submit]');
      if (b) S.clicks.push((b.textContent || b.value || b.id || '').trim());
    },
    true,
  );
  // long page so scrolling is observable
  window.addEventListener('DOMContentLoaded', () => {
    const main = document.createElement('main');
    main.id = 'filler';
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('p');
      p.textContent = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(8);
      main.appendChild(p);
    }
    document.body.appendChild(main);
  });
})();

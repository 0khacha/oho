/**
 * MAIN-world bridge. Content scripts live in an isolated world and cannot call a CMP's
 * JavaScript API, so the rule engine dispatches `oho:api` with a CMP id and this script
 * calls that CMP's own *reject* function. The map is fixed: nothing from the event is
 * ever evaluated, and the only possible effect is a refusal of consent.
 */
type Fn = () => boolean;
const w = window as unknown as Record<string, any>;

const has = (o: unknown, k: string): boolean => !!o && typeof (o as Record<string, unknown>)[k] === 'function';

const API: Record<string, Fn> = {
  onetrust: () => has(w.OneTrust, 'RejectAll') && (w.OneTrust.RejectAll(), true),
  // Live check (5 Cookiebot sites, 2026-11): `Cookiebot.decline` does not exist; the documented
  // `submitCustomConsent(preferences, statistics, marketing)` does on all of them.
  cookiebot: () => has(w.Cookiebot, 'submitCustomConsent') && (w.Cookiebot.submitCustomConsent(false, false, false), true),
  didomi: () => has(w.Didomi, 'setUserDisagreeToAll') && (w.Didomi.setUserDisagreeToAll(), true),
  usercentrics: () => {
    if (has(w.__ucCmp, 'denyAllConsents')) return void w.__ucCmp.denyAllConsents(), true;
    if (has(w.UC_UI, 'denyAllConsents')) {
      w.UC_UI.denyAllConsents();
      if (has(w.UC_UI, 'closeCMP')) w.UC_UI.closeCMP();
      return true;
    }
    return false;
  },
  // Complianz (confirmed on wpzoom.com / wpmayor.com): cmplz_deny_all() stores the denial;
  // cmplz_set_banner_status('dismissed') records that the banner was answered.
  complianz: () => {
    if (typeof w.cmplz_deny_all !== 'function') return false;
    w.cmplz_deny_all();
    if (typeof w.cmplz_set_banner_status === 'function') w.cmplz_set_banner_status('dismissed');
    return true;
  },
  // Iubenda has no public reject call, but sites following the Italian Garante guidelines set
  // `banner.closeButtonRejects`: the "x" then means "continue without accepting". Only then do we use it.
  iubenda: () => {
    if (w._iub?.csConfiguration?.banner?.closeButtonRejects !== true) return false;
    const x = document.querySelector<HTMLElement>('#iubenda-cs-banner .iubenda-cs-close-btn');
    return !!x && (x.click(), true);
  },
};

document.addEventListener('oho:api', (e) => {
  const id = String((e as CustomEvent).detail);
  let ok = false;
  try {
    ok = Object.prototype.hasOwnProperty.call(API, id) && API[id]!() === true;
  } catch {
    ok = false;
  }
  document.dispatchEvent(new CustomEvent('oho:api-done', { detail: `${id}:${ok ? 1 : 0}` }));
});

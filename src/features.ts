import { RE, bannerG, norm } from './shared/keywords';
import { labelOf } from './shared/dom';
import type { Cand } from './candidates';

export const BTN_SEL = 'button,[role=button],a,input[type=button],input[type=submit]';

export const FEATURES = [
  'kw_banner',
  'has_reject',
  'has_accept',
  'has_settings',
  'n_buttons',
  'area',
  'near_edge',
  'z_high',
  'text_len',
  'is_dialog',
  'privacy_link',
  'width_ratio',
  'id_hint',
  'has_inputs',
] as const;
export type Feature = (typeof FEATURES)[number];
export type Vec = Record<Feature, number>;

const POLICY_LINK =
  'a[href*=privacy i],a[href*=cookie i],a[href*=datenschutz i],a[href*=confidentialit i],a[href*=privacidad i],a[href*=rgpd i],a[href*=gdpr i]';
const INPUTS =
  'input[type=text],input[type=email],input[type=password],input[type=search],input[type=tel],input:not([type]),textarea,select';
const ID_HINT = /cookie|consent|gdpr|rgpd|dsgvo|\bcmp\b|privacy|tracking/;

const b = (v: unknown): number => (v ? 1 : 0);

/** Features for one candidate. Pure reads: textContent / attributes, no layout. */
export function extract(c: Cand): Vec {
  const { el, rect, z, vw, vh } = c;
  const text = norm((el.textContent ?? '').slice(0, 4000));
  const hits = text.match(bannerG())?.length ?? 0;
  const btns = [...el.querySelectorAll(BTN_SEL)].slice(0, 30);
  const labels = btns.map(labelOf).filter((l) => l.length > 0 && l.length <= 60);
  const first = el.firstElementChild;
  const hint = `${el.id} ${el.getAttribute('class') ?? ''} ${first?.id ?? ''} ${first?.getAttribute('class') ?? ''}`.toLowerCase();

  return {
    kw_banner: Math.min(hits, 5) / 5,
    has_reject: b(labels.some((l) => RE.reject.test(l))),
    has_accept: b(labels.some((l) => !RE.reject.test(l) && RE.accept.test(l))),
    has_settings: b(labels.some((l) => RE.settings.test(l))),
    n_buttons: Math.min(btns.length, 6) / 6,
    area: Math.min((rect.width * rect.height) / (vw * vh), 1),
    near_edge: b(rect.top <= 12 || rect.bottom >= vh - 12),
    z_high: Math.min(Math.log10(Math.max(z, 0) + 1) / 4, 1),
    text_len: b(text.length >= 40 && text.length <= 3000),
    is_dialog: b(
      el.matches('[role=dialog],[role=alertdialog],[aria-modal=true],dialog') ||
        el.querySelector('[role=dialog],[role=alertdialog],[aria-modal=true],dialog'),
    ),
    privacy_link: b(el.querySelector(POLICY_LINK)),
    width_ratio: Math.min(rect.width / vw, 1),
    id_hint: b(ID_HINT.test(hint)),
    has_inputs: b(el.querySelector(INPUTS)),
  };
}

import { BTN_SEL } from './features';
import { isVisible, labelOf } from './shared/dom';
import { PRICE, RE } from './shared/keywords';

/**
 * A link inside running text ("… für Utiq jetzt ablehnen …" in bild.de's message) is a
 * per-partner aside, not one of the banner's choices.
 */
function inline(el: Element, label: string): boolean {
  if (el.tagName !== 'A') return false;
  const block = el.parentElement?.closest('p,li,span,div');
  return !!block && (block.textContent ?? '').trim().length > label.length * 2 + 20;
}

/**
 * A pay-or-accept wall: the visible choices are "accept" and "pay" ("subscribe", "PUR-Abo",
 * "3,99 €/Monat"), and there is no free way to refuse. Seen live on kicker.de, marca.com,
 * repubblica.it, lemonde.fr, liberation.fr, bild.de and tagesspiegel.de.
 *
 * This is deliberately different from a notice with no refuse button at all (ibm.com,
 * xataka.com): those have no paid option and are still hidden by default.
 */
export function isWall(root: ParentNode): boolean {
  let pay = false;
  let accept = false;
  let freeReject = false;
  let n = 0;
  for (const b of root.querySelectorAll(BTN_SEL)) {
    if (++n > 60) break;
    const t = labelOf(b);
    if (!t || t.length > 80 || !isVisible(b) || inline(b, t)) continue;
    if (RE.pay.test(t) || PRICE.test(t)) pay = true;
    else if (RE.reject.test(t)) freeReject = true;
    else if (RE.accept.test(t)) accept = true;
  }
  return pay && accept && !freeReject;
}

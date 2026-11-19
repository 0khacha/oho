import { BTN_SEL } from './features';
import { isVisible, labelOf } from './shared/dom';
import { PRICE, RE } from './shared/keywords';

/**
 * A link inside running text ("… für Utiq jetzt ablehnen …" in bild.de's message) is a
 * per-partner aside, not one of the banner's choices.
 */
function inline(el: Element, label: string): boolean {
  if (el.tagName !== 'A' || !el.parentElement) return false;
  // A link styled as a button (block / inline-block / flex) is a choice, wherever it sits.
  if (getComputedStyle(el).display !== 'inline') return false;
  // Only text *directly around* the link counts (bild.de: a link inside a sentence). A standalone
  // link button in a column of text (kicker.de's "PUR-Abo kaufen") is not inline.
  let around = 0;
  for (const n of el.parentElement.childNodes) if (n.nodeType === 3) around += (n.textContent ?? '').trim().length;
  return around > Math.max(20, label.length);
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

/**
 * The banner offers a paid option that is not visible yet (buttons fading in: kicker.de,
 * lemonde.fr). Deciding now would mistake a wall for a plain notice, so the caller waits.
 */
export function payPending(root: ParentNode): boolean {
  let n = 0;
  for (const b of root.querySelectorAll(BTN_SEL)) {
    if (++n > 60) break;
    const t = labelOf(b);
    if (t && t.length <= 80 && (RE.pay.test(t) || PRICE.test(t)) && !isVisible(b)) return true;
  }
  return false;
}

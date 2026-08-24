import type { ElementKind, TargetInfo } from '../types';
import { cssSelector } from './css';
import { getTestId } from './stable';
import { shortName } from './text-name';
import { absoluteXPath, countXPath, robustXPath, xpathByText } from './xpath';

export { accessibleName, shortName } from './text-name';
export { absoluteXPath, robustXPath, xpathByText, countXPath } from './xpath';
export { cssSelector } from './css';
export { getTestId, isStableIdent } from './stable';

const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);

export function elementKind(el: Element): ElementKind {
  const tag = el.localName;
  const role = el.getAttribute('role');

  if (tag === 'input') {
    const type = (el as HTMLInputElement).type.toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (BUTTON_INPUT_TYPES.has(type)) return 'button';
    return 'input';
  }
  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (role === 'link') return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (el.hasAttribute('contenteditable')) return 'textarea';
  return 'other';
}

/**
 * The element the user meant, not the element the event landed on. Clicking a
 * button that contains an <svg> and a <span> reports the deepest node, which is
 * never what a test should target.
 */
export function resolveInteractive(el: Element): Element {
  const interactive = el.closest(
    'button, a[href], input, select, textarea, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [onclick], [contenteditable]',
  );
  if (interactive) return interactive;

  // Clicking page background resolves to <html>, whose locator is `/html` —
  // valid XPath, useless test step. `body` is the honest target for a background
  // click, and clicking the background to dismiss a menu is a real test action,
  // so this is normalised rather than dropped.
  if (el === el.ownerDocument.documentElement) {
    return el.ownerDocument.body ?? el;
  }
  return el;
}

/** Everything the recorder and the codegen need to know about one element. */
export function describeElement(el: Element): TargetInfo {
  const doc = el.ownerDocument;
  const textName = shortName(el);
  const xpath = robustXPath(el, doc);
  const testId = getTestId(el);

  return {
    xpath,
    xpathAbsolute: absoluteXPath(el),
    xpathByText: xpathByText(el, textName, doc),
    cssSelector: cssSelector(el, doc),
    testId: testId?.value,
    textName,
    role: el.getAttribute('role') ?? undefined,
    ariaLabel: el.getAttribute('aria-label') ?? undefined,
    tagName: el.localName,
    inputType: el.localName === 'input' ? (el as HTMLInputElement).type : undefined,
    elementKind: elementKind(el),
    unique: countXPath(xpath, doc) === 1,
  };
}

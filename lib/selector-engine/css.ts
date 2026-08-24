import { getTestId, isStableIdent, stableClasses } from './stable';

function countCss(selector: string, doc: Document = document): number {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function cssHop(el: Element, withNth: boolean): string {
  let hop = el.localName;
  for (const cls of stableClasses(el)) hop += `.${CSS.escape(cls)}`;
  if (withNth) {
    const parent = el.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.localName === el.localName);
      if (sameTag.length > 1) hop += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
    }
  }
  return hop;
}

/**
 * Shortest selector that still matches exactly one element. Grows the path
 * upwards one ancestor at a time and stops as soon as it is unambiguous, so a
 * well-marked element yields something short and readable.
 */
export function cssSelector(el: Element, doc: Document = document): string {
  const testId = getTestId(el);
  if (testId) {
    const selector = `[${testId.attr}="${CSS.escape(testId.value)}"]`;
    if (countCss(selector, doc) === 1) return selector;
  }

  const id = el.getAttribute('id');
  if (isStableIdent(id)) {
    const selector = `#${CSS.escape(id)}`;
    if (countCss(selector, doc) === 1) return selector;
  }

  const path: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    // Try the cheap form first; fall back to positional only when needed.
    path.unshift(cssHop(n, false));
    let selector = path.join(' > ');
    if (countCss(selector, doc) === 1) return selector;

    path[0] = cssHop(n, true);
    selector = path.join(' > ');
    if (countCss(selector, doc) === 1) return selector;

    const ancestorId = n.parentElement?.getAttribute('id');
    if (isStableIdent(ancestorId)) {
      const anchored = `#${CSS.escape(ancestorId)} > ${selector}`;
      if (countCss(anchored, doc) === 1) return anchored;
    }
  }

  return path.join(' > ');
}

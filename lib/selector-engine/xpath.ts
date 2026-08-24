import { getTestId, isStableIdent } from './stable';

/** Count nodes an XPath matches. Returns 0 for a malformed expression. */
export function countXPath(xpath: string, doc: Document = document): number {
  try {
    return doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
      .snapshotLength;
  } catch {
    return 0;
  }
}

/** Wrap a value as an XPath string literal, or return undefined if impossible. */
export function xpathLiteral(value: string): string | undefined {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  // Both quote characters present. XPath 1.0 has no escape, so concat() is the
  // only way — not worth the unreadability for a recorded locator.
  return undefined;
}

/** One `tag` or `tag[n]` hop, indexed only when the tag repeats among siblings. */
function hop(el: Element): string {
  const tag = el.localName;
  const parent = el.parentElement;
  if (!parent) return tag;
  const sameTag = Array.from(parent.children).filter((c) => c.localName === tag);
  if (sameTag.length === 1) return tag;
  return `${tag}[${sameTag.indexOf(el) + 1}]`;
}

/** Full structural path from the root. Always unique, always fragile. */
export function absoluteXPath(el: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) parts.unshift(hop(n));
  return `/${parts.join('/')}`;
}

/** An `[@attr="value"]` predicate that identifies this element on its own merits. */
function anchorPredicate(el: Element): string | undefined {
  const testId = getTestId(el);
  if (testId) {
    const lit = xpathLiteral(testId.value);
    if (lit) return `[@${testId.attr}=${lit}]`;
  }
  const id = el.getAttribute('id');
  if (isStableIdent(id)) {
    const lit = xpathLiteral(id);
    if (lit) return `[@id=${lit}]`;
  }
  const name = el.getAttribute('name');
  if (isStableIdent(name)) {
    const lit = xpathLiteral(name);
    if (lit) return `[@name=${lit}]`;
  }
  return undefined;
}

/**
 * Preferred XPath: anchored on the closest ancestor that has a stable attribute,
 * with a short structural tail. This survives sibling reordering and unrelated
 * DOM changes elsewhere on the page, which an absolute path does not.
 */
export function robustXPath(el: Element, doc: Document = document): string {
  const own = anchorPredicate(el);
  if (own) {
    const candidate = `//${el.localName}${own}`;
    if (countXPath(candidate, doc) === 1) return candidate;
  }

  const tail: string[] = [hop(el)];
  for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const pred = anchorPredicate(ancestor);
    if (pred) {
      const candidate = `//${ancestor.localName}${pred}/${tail.join('/')}`;
      if (countXPath(candidate, doc) === 1) return candidate;
    }
    tail.unshift(hop(ancestor));
  }

  return absoluteXPath(el);
}

/**
 * Text-driven XPath, the locator a manual tester writes by hand:
 * `//button[normalize-space()="Save"]`. Only returned when it is unambiguous.
 */
export function xpathByText(
  el: Element,
  text: string,
  doc: Document = document,
): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return undefined;
  const lit = xpathLiteral(trimmed);
  if (!lit) return undefined;

  const tag = el.localName;
  const exact = `//${tag}[normalize-space()=${lit}]`;
  if (countXPath(exact, doc) === 1) return exact;

  const partial = `//${tag}[contains(normalize-space(),${lit})]`;
  if (countXPath(partial, doc) === 1) return partial;

  return undefined;
}

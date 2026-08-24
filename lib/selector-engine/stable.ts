/** Attributes a team may use to mark elements for automation, in priority order. */
export const TEST_ID_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-cy',
  'data-qa',
  'data-qa-id',
  'data-automation-id',
] as const;

/**
 * Patterns for ids and class names that a framework generated at runtime. These
 * change on every render or every build, so a locator built on them passes once
 * and then fails in CI for no visible reason — the single most common cause of
 * flaky recorded tests. We would rather emit a longer structural locator.
 */
const GENERATED = [
  /^:r[0-9a-z]*:?$/i, // React useId
  /^«.*»$/, // React useId, alternate serialisation
  /^(ember|mui-|radix-|headlessui-|downshift-|rc-|ant-)/i,
  /^css-[0-9a-z]{4,}$/i, // emotion / styled-components
  /^[\w-]*_[\w-]*_[0-9a-z]{4,}$/i, // CSS modules
  /[0-9a-f]{8,}/i, // embedded hash
  /\d{5,}/, // long numeric run
  /^\d/, // starts with a digit
];

export function looksGenerated(value: string): boolean {
  return GENERATED.some((re) => re.test(value));
}

export function isStableIdent(value: string | null | undefined): value is string {
  if (!value) return false;
  const v = value.trim();
  if (!v || v.length > 60 || /\s/.test(v)) return false;
  return !looksGenerated(v);
}

export interface TestIdHit {
  attr: string;
  value: string;
}

export function getTestId(el: Element): TestIdHit | undefined {
  for (const attr of TEST_ID_ATTRS) {
    const value = el.getAttribute(attr);
    if (value?.trim()) return { attr, value: value.trim() };
  }
  return undefined;
}

/** Class names worth putting in a selector: readable, and not build output. */
export function stableClasses(el: Element, max = 2): string[] {
  return Array.from(el.classList)
    .filter((c) => c.length >= 3 && c.length <= 30 && !looksGenerated(c))
    .slice(0, max);
}

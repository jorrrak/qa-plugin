import type { ElementKind, FrameRef, TargetInfo } from '../types';

export type LocatorStrategy = 'smart' | 'xpath' | 'css';

export interface CodegenOptions {
  /**
   * `smart` prefers test ids and roles and only falls back to XPath. `xpath`
   * forces the recorded XPath everywhere, which is what a team with an existing
   * XPath-based suite usually wants even though it is more brittle.
   */
  locatorStrategy: LocatorStrategy;
  testName: string;
  baseUrl?: string;
}

export const js = (value: string): string => {
  // XPath expressions are full of double quotes. JSON.stringify would escape
  // every one of them, and `"xpath=//input[@id=\"email\"]"` is hard to read in
  // a generated file a human has to maintain.
  const safeInSingleQuotes =
    value.includes('"') && !value.includes("'") && !/[\\\n\r]/.test(value);
  return safeInSingleQuotes ? `'${value}'` : JSON.stringify(value);
};

/** Python string literal. JSON escaping is a valid subset for our inputs. */
export const py = (value: string): string => JSON.stringify(value);

export const ARIA_ROLE_BY_KIND: Partial<Record<ElementKind, string>> = {
  button: 'button',
  link: 'link',
  checkbox: 'checkbox',
  radio: 'radio',
  input: 'textbox',
  textarea: 'textbox',
  select: 'combobox',
};

export function ariaRole(target: TargetInfo): string | undefined {
  return target.role ?? ARIA_ROLE_BY_KIND[target.elementKind];
}

/** A short human label for the element, used in comments and step titles. */
export function describeTarget(target: TargetInfo): string {
  const name = target.textName ? `"${target.textName}"` : '(no visible text)';
  return `${target.elementKind} ${name}`;
}

export function indent(lines: string[], spaces: number): string {
  const pad = ' '.repeat(spaces);
  return lines.map((line) => (line ? pad + line : line)).join('\n');
}

/** The iframe locator to use, honouring the chosen strategy. */
export function frameSelector(ref: FrameRef, options: CodegenOptions): string {
  return options.locatorStrategy === 'xpath' ? ref.xpath : ref.selector;
}

export function samePath(a: FrameRef[] = [], b: FrameRef[] = []): boolean {
  if (a.length !== b.length) return false;
  return a.every((ref, i) => ref.selector === b[i]?.selector && ref.xpath === b[i]?.xpath);
}

/**
 * A step whose frame chain never resolved cannot be targeted. Callers emit this
 * as a comment rather than dropping the step, so the gap is visible in the file
 * instead of being a silently missing action.
 */
export function unresolvedFrameNote(path: FrameRef[] | undefined): string | undefined {
  if (!path?.some((ref) => ref.unresolved)) return undefined;
  return 'FIXME: this step happened inside an iframe the recorder could not identify — add the frame locator by hand.';
}

/**
 * Turns generated statements into comments. Lines that are already comments are
 * left alone rather than double-prefixed.
 */
export function commentOut(lines: string[], token: '//' | '#'): string[] {
  return lines.map((line) =>
    line.trimStart().startsWith(token) ? line : `${token} ${line}`,
  );
}

/**
 * How a step's value reaches the generated code. A variable reference always
 * wins over a literal: that is the whole point of defining test data once.
 * `TEST_PASSWORD` remains the fallback name for a password field that matched no
 * variable, so an older recording still generates something runnable.
 */
export function valueExpr(
  step: { value?: string; sensitive?: boolean; variable?: string },
  language: 'js' | 'python',
): string {
  const name = step.variable ?? (step.sensitive ? 'TEST_PASSWORD' : undefined);
  if (name) {
    return language === 'python' ? `os.environ["${name}"]` : `process.env.${name} ?? ""`;
  }
  const literal = step.value ?? '';
  return language === 'python' ? py(literal) : js(literal);
}

/** Cypress reads its own env store rather than process.env. */
export function cypressValueExpr(step: {
  value?: string;
  sensitive?: boolean;
  variable?: string;
}): { expr: string; quiet: boolean } {
  const name = step.variable ?? (step.sensitive ? 'TEST_PASSWORD' : undefined);
  if (name) return { expr: `Cypress.env("${name}")`, quiet: !!step.sensitive };
  return { expr: js(step.value ?? ''), quiet: false };
}

export const BASE_URL_VARIABLE = 'BASE_URL';

/**
 * The path part of a recorded URL, when it sits under the configured base.
 *
 * Applied at generation time rather than at recording time: the recorded URL is a
 * fact, while the base is a presentation choice. Doing it here means one
 * recording can produce an absolute script or a base-relative one, and that
 * defining BASE_URL after recording still works.
 */
export function relativeToBase(url: string, baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  const base = baseUrl.replace(/\/+$/, '');
  if (!base || !url.startsWith(base)) return undefined;

  const rest = url.slice(base.length);
  if (rest === '') return '/';
  // Guards against `https://app.test` matching `https://app.testing.com`.
  if (!rest.startsWith('/') && !rest.startsWith('?') && !rest.startsWith('#')) {
    return undefined;
  }
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/** Every variable a set of steps needs, for the header of a generated file. */
export function requiredVariables(
  steps: { sensitive?: boolean; variable?: string; action?: string; value?: string; url?: string }[],
  baseUrl?: string,
): string[] {
  const names = steps.map((step) => step.variable ?? (step.sensitive ? 'TEST_PASSWORD' : undefined));

  // BASE_URL only counts as required if a navigation actually resolved against it.
  const usesBase = steps.some(
    (step) =>
      step.action === 'navigate' &&
      relativeToBase(step.value ?? step.url ?? '', baseUrl) !== undefined,
  );
  if (usesBase) names.push(BASE_URL_VARIABLE);

  return [...new Set(names.filter((n): n is string => !!n))].sort();
}

/**
 * Warns when a recording never captured the page it started on.
 *
 * Recordings made before the recorder logged the opening URL have no navigation
 * step, so the generated script begins on a blank page and fails on its first
 * action. Saying so at the top of the file is the difference between a five-minute
 * fix and an afternoon of debugging a locator that was never the problem.
 */
export function missingNavigationNote(
  steps: { action: string; url?: string }[],
): string | undefined {
  if (steps.length === 0) return undefined;
  if (steps.some((step) => step.action === 'navigate')) return undefined;

  const firstUrl = steps.find((step) => step.url)?.url;
  return `FIXME: this recording has no opening navigation — it was recorded on a page that was already open. Add it as the first step${
    firstUrl ? `, e.g. ${firstUrl}` : ''
  }.`;
}

/**
 * A Python identifier from a test-case title.
 *
 * Only ASCII survives here, so a Persian or Arabic title slugs down to nothing —
 * the position is used instead, and callers keep the real title as a docstring.
 */
export function pythonIdentifier(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug || /^\d/.test(slug)) return `case_${index + 1}`;
  return slug;
}

/** Makes a set of identifiers unique, so two same-titled cases cannot collide. */
export function uniqueIdentifier(base: string, taken: Set<string>): string {
  let name = base;
  let suffix = 2;
  while (taken.has(name)) name = `${base}_${suffix++}`;
  taken.add(name);
  return name;
}

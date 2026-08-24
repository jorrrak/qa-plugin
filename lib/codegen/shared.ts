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

/** Every variable a set of steps needs, for the header of a generated file. */
export function requiredVariables(
  steps: { sensitive?: boolean; variable?: string }[],
): string[] {
  const names = steps.map((step) => step.variable ?? (step.sensitive ? 'TEST_PASSWORD' : undefined));
  return [...new Set(names.filter((n): n is string => !!n))].sort();
}

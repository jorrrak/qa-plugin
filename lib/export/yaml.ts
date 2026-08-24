import type { Issue, RecordedStep, Session } from '../types';

/**
 * A small YAML emitter, and a test-case shape designed to be read and diffed by
 * a person rather than to mirror the internal model.
 *
 * Writing YAML by string concatenation is where this normally goes wrong. The
 * values here are hostile to it: XPath expressions are full of `"`, `[` and `@`;
 * a typed card number must stay a string and not become a float; and `no`, `yes`,
 * `on`, `off`, `~` are booleans and null in YAML 1.1, so an element literally
 * named "No" would round-trip as `false`. Every scalar therefore goes through
 * `scalar()` below.
 */

type YamlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | YamlValue[]
  | { [key: string]: YamlValue };

/** Characters that change a scalar's meaning when they lead it. */
const LEADING_INDICATORS = new Set([
  '-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!',
  '|', '>', "'", '"', '%', '@', '`',
]);

/** Words YAML 1.1 parsers read as booleans or null. */
const RESERVED_WORDS =
  /^(?:~|null|true|false|y|n|yes|no|on|off)$/i;

function scalar(value: string): string {
  // A double-quoted YAML scalar accepts exactly the JSON escape set, so
  // JSON.stringify is a correct — and safe — fallback for every hard case.
  if (value === '') return "''";
  if (LEADING_INDICATORS.has(value[0]!)) return JSON.stringify(value);
  if (RESERVED_WORDS.test(value)) return JSON.stringify(value);
  // Anything that could be read as a number or a date stays a string. A card
  // number or a version like `1.10` must not become a float.
  if (/^[-+.\d]/.test(value)) return JSON.stringify(value);
  if (/[\n\r\t]/.test(value)) return JSON.stringify(value);
  if (/:(?:\s|$)/.test(value) || /\s#/.test(value)) return JSON.stringify(value);
  if (value !== value.trim()) return JSON.stringify(value);
  return value;
}

function isPlainObject(value: YamlValue): value is { [key: string]: YamlValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComposite(value: YamlValue): boolean {
  return Array.isArray(value) || isPlainObject(value);
}

/** Entries whose value is undefined or null are dropped, keeping output terse. */
function entriesOf(value: { [key: string]: YamlValue }): [string, YamlValue][] {
  return Object.entries(value).filter(([, v]) => v !== undefined && v !== null);
}

const pad = (level: number) => '  '.repeat(level);

/**
 * Emitting as lines with an explicit level, rather than as concatenated strings,
 * is what keeps nesting correct. The subtlety is the sequence item: `- ` occupies
 * two columns, so a map inside a list has its keys one level deeper than the dash,
 * and anything nested under those keys one level deeper again.
 */
function emitMapLines(value: { [key: string]: YamlValue }, level: number): string[] {
  return entriesOf(value).flatMap(([key, child]) => {
    if (!isComposite(child)) {
      return [`${pad(level)}${key}: ${emitScalar(child)}`];
    }
    const nested = Array.isArray(child)
      ? emitSeqLines(child, level + 1)
      : emitMapLines(child as { [key: string]: YamlValue }, level + 1);
    if (nested.length === 0) {
      return [`${pad(level)}${key}: ${Array.isArray(child) ? '[]' : '{}'}`];
    }
    return [`${pad(level)}${key}:`, ...nested];
  });
}

function emitSeqLines(value: YamlValue[], level: number): string[] {
  return value.flatMap((item) => {
    if (isPlainObject(item)) {
      const lines = emitMapLines(item, level + 1);
      if (lines.length === 0) return [`${pad(level)}- {}`];
      // Replace the first line's indent with the dash, keeping the column.
      return [`${pad(level)}- ${lines[0]!.slice((level + 1) * 2)}`, ...lines.slice(1)];
    }
    if (Array.isArray(item)) {
      const lines = emitSeqLines(item, level + 1);
      return lines.length === 0 ? [`${pad(level)}- []`] : [`${pad(level)}-`, ...lines];
    }
    return [`${pad(level)}- ${emitScalar(item)}`];
  });
}

function emitScalar(value: YamlValue): string {
  if (typeof value === 'string') return scalar(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'null';
}

export function toYamlDocument(root: { [key: string]: YamlValue }): string {
  return `${emitMapLines(root, 0).join('\n')}\n`;
}

/* ---- the test-case schema ------------------------------------------------ */

const ACTION_LABEL: Record<string, string> = {
  assertText: 'assertText',
  assertValue: 'assertValue',
  assertVisible: 'assertVisible',
  assertHidden: 'assertHidden',
  assertUrl: 'assertUrl',
};

function elementOf(step: RecordedStep): YamlValue {
  const target = step.target;
  if (!target) return undefined;
  return {
    name: target.textName || undefined,
    type: target.elementKind,
    tag: target.tagName,
    testId: target.testId,
    xpath: target.xpath,
    css: target.cssSelector,
    // Only worth stating when it is false; true is the normal case.
    ambiguous: target.unique ? undefined : true,
  };
}

function frameOf(step: RecordedStep): YamlValue {
  const path = step.framePath ?? [];
  if (path.length === 0) return undefined;
  return path.map((ref) => ({
    name: ref.name,
    selector: ref.selector || undefined,
    xpath: ref.xpath || undefined,
    unresolved: ref.unresolved ? true : undefined,
  }));
}

function stepOf(step: RecordedStep): YamlValue {
  const isAssertion = step.action in ACTION_LABEL;
  return {
    step: step.seq,
    action: step.action,
    note: step.note,
    element: elementOf(step),
    frame: frameOf(step),
    // A reference to test data rather than the literal, when there is one.
    variable: step.variable,
    // An assertion's value is what is expected; an action's is what was entered.
    ...(step.variable
      ? {}
      : isAssertion
        ? { expected: step.value }
        : { value: step.value }),
    secret: step.sensitive ? true : undefined,
  };
}

function issueOf(session: Session, issue: Issue): YamlValue {
  const cause = session.steps.find((step) => step.id === issue.nearStepId);
  return {
    severity: issue.severity,
    type: issue.kind,
    message: issue.message,
    afterStep: cause?.seq,
    afterElement: cause?.target?.textName || undefined,
    occurrences: issue.count,
  };
}

function testCaseOf(session: Session): YamlValue {
  const startUrl =
    session.steps.find((step) => step.action === 'navigate')?.value ??
    session.steps[0]?.url;

  return {
    title: session.title,
    recordedAt: new Date(session.startedAt).toISOString(),
    startUrl,
    stepCount: session.steps.length,
    assertionCount: session.steps.filter((step) => step.action in ACTION_LABEL).length,
    steps: session.steps.map(stepOf),
    issues: session.issues.length
      ? session.issues.map((issue) => issueOf(session, issue))
      : undefined,
  };
}

export function toYaml(sessions: Session[]): string {
  const header = [
    '# QA Plugin — recorded test cases',
    '# Generated export. Edit the source recording rather than this file:',
    '# re-exporting overwrites it.',
    '',
  ].join('\n');

  return (
    header +
    toYamlDocument({
      format: 'qa-plugin-testcases',
      version: 1,
      exportedAt: new Date().toISOString(),
      testCases: sessions.map(testCaseOf),
    })
  );
}

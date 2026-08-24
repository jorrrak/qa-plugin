import type { Session } from '../types';

function cell(value: string | undefined): string {
  if (!value) return '—';
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const ACTION_LABEL: Record<string, string> = {
  click: 'Click',
  dblclick: 'Double-click',
  fill: 'Type',
  select: 'Select',
  check: 'Check',
  uncheck: 'Uncheck',
  press: 'Press key',
  submit: 'Submit',
  navigate: 'Go to',
  assertText: 'Assert text',
  assertValue: 'Assert value',
  assertVisible: 'Assert visible',
  assertHidden: 'Assert hidden',
  assertUrl: 'Assert URL',
};

/**
 * The hand-off document for manual QA and for a ticket: numbered steps with the
 * element name, the XPath, and the value that was entered.
 */
/** A variable reference reads better than a literal, and never leaks a secret. */
function valueCell(step: Session['steps'][number]): string {
  if (step.variable) return `\`\${${step.variable}}\``;
  if (step.sensitive) return '`<password>`';
  return cell(step.value);
}

function frameCell(step: Session['steps'][number]): string {
  const path = step.framePath ?? [];
  if (path.length === 0) return 'main';
  if (path.some((ref) => ref.unresolved)) return '⚠ unidentified iframe';
  return path.map((ref) => `\`${cell(ref.name ?? ref.selector)}\``).join(' › ');
}

function sectionFor(session: Session, level: string): string {
  const rows = session.steps.map((step) => {
    const t = step.target;
    return `| ${step.seq} | ${ACTION_LABEL[step.action] ?? step.action} | ${cell(
      t?.textName,
    )} | ${cell(t?.elementKind)} | ${frameCell(step)} | \`${cell(t?.xpath ?? step.value)}\` | ${valueCell(step)} |`;
  });

  const issueRows = session.issues.map((issue) => {
    const step = session.steps.find((s) => s.id === issue.nearStepId);
    const after = step ? `after step ${step.seq}` : 'no linked step';
    return `| ${issue.severity} | ${issue.kind} | ${cell(issue.message)} | ${after} | ${issue.count} |`;
  });

  const assertions = session.steps.filter((step) => step.action.startsWith('assert')).length;

  return `${level} ${session.title}

- **Recorded:** ${new Date(session.startedAt).toISOString()}
- **Steps:** ${session.steps.length} (${assertions} assertion${assertions === 1 ? '' : 's'})
- **Issues detected:** ${session.issues.length}

${level}# Steps

| # | Action | Element | Kind | Frame | XPath | Value |
|---|--------|---------|------|-------|-------|-------|
${rows.join('\n') || '| — | — | — | — | — | — | — |'}

${level}# Detected issues

${
  issueRows.length
    ? `| Severity | Kind | Message | When | Count |
|----------|------|---------|------|-------|
${issueRows.join('\n')}`
    : 'None detected during this recording.'
}
`;
}

/**
 * The hand-off document for manual QA and for a ticket: numbered steps with the
 * element name, the XPath, and the value that was entered.
 */
export function toMarkdown(sessions: Session[]): string {
  if (sessions.length === 1) return sectionFor(sessions[0]!, '#');

  // A multi-case export gets a real title so the sections nest under it.
  const total = sessions.reduce((sum, s) => sum + s.steps.length, 0);
  return `# Test suite — ${sessions.length} test cases, ${total} steps

${sessions.map((session) => sectionFor(session, '##')).join('\n---\n\n')}`;
}

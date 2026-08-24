import type { Session } from '../types';

/**
 * One tabular shape shared by the CSV and the XLSX writers, so the two can never
 * drift into disagreeing about what a test-case export contains.
 */

export interface Table {
  name: string;
  headers: string[];
  rows: (string | number)[][];
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

function frameCell(step: Session['steps'][number]): string {
  const path = step.framePath ?? [];
  if (path.length === 0) return 'main';
  if (path.some((ref) => ref.unresolved)) return 'unidentified iframe';
  return path.map((ref) => ref.name ?? ref.selector).join(' > ');
}

/**
 * A step's value as a sheet cell. A variable reference is shown as `${NAME}` so a
 * spreadsheet handed to someone else carries no credential, and so replacing the
 * test account means changing one variable rather than every row.
 */
function valueCell(step: Session['steps'][number]): string {
  if (step.variable) return `\${${step.variable}}`;
  // A recorded password is never in the session to begin with; this says so
  // rather than looking like an empty field somebody forgot.
  if (step.sensitive) return '<password not stored>';
  return step.value ?? '';
}

export const STEP_HEADERS = [
  'Test Case',
  'Step',
  'Action',
  'Element',
  'Element Type',
  'Frame',
  'XPath',
  'CSS Selector',
  'Test ID',
  'Value',
  'Note',
  'URL',
];

export const ISSUE_HEADERS = [
  'Test Case',
  'Severity',
  'Type',
  'Message',
  'Detected After Step',
  'Count',
  'URL',
];

export function stepsTable(sessions: Session[]): Table {
  const rows = sessions.flatMap((session) =>
    session.steps.map((step) => [
      session.title,
      step.seq,
      ACTION_LABEL[step.action] ?? step.action,
      step.target?.textName ?? '',
      step.target?.elementKind ?? '',
      frameCell(step),
      step.target?.xpath ?? '',
      step.target?.cssSelector ?? '',
      step.target?.testId ?? '',
      valueCell(step),
      step.note ?? '',
      step.url,
    ]),
  );
  return { name: 'Steps', headers: STEP_HEADERS, rows };
}

export function issuesTable(sessions: Session[]): Table {
  const rows = sessions.flatMap((session) =>
    session.issues.map((issue) => {
      const cause = session.steps.find((step) => step.id === issue.nearStepId);
      return [
        session.title,
        issue.severity,
        issue.kind,
        issue.message,
        cause ? `${cause.seq}${cause.target?.textName ? ` — ${cause.target.textName}` : ''}` : '',
        issue.count,
        issue.url,
      ];
    }),
  );
  return { name: 'Issues', headers: ISSUE_HEADERS, rows };
}

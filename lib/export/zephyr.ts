import { isAssertion, type RecordedStep, type Session } from '../types';
import { tableToCsv } from './csv';
import type { Table } from './rows';
import { buildXlsx } from './xlsx';

/**
 * Zephyr Scale's CSV / Excel test-case importer.
 *
 * The interesting part is not the column names — it is that Zephyr models a test
 * step as one triple: **do this, with this data, expect that**. A recording does
 * not: an assertion is its own step, sitting after the action it checks. So the
 * transformation here folds each run of assertions into the *preceding* action's
 * Expected Result, which is the shape a manual tester reading Zephyr expects.
 *
 * Locators are deliberately left out. Zephyr has no field for an XPath, and a
 * test case a human reads should not carry one. The Playwright/CSV/YAML exports
 * are the automation artefact; this one is the human test case.
 */

const STEP_COLUMNS = [
  'Name',
  'Objective',
  'Precondition',
  'Folder',
  'Priority',
  'Status',
  'Test Script (Step-by-Step) - Step',
  'Test Script (Step-by-Step) - Test Data',
  'Test Script (Step-by-Step) - Expected Result',
];

function quoted(name: string | undefined): string {
  return name ? `"${name}"` : 'the element';
}

function elementPhrase(step: RecordedStep): string {
  const target = step.target;
  if (!target) return 'the element';
  const kind = target.elementKind === 'other' ? 'element' : target.elementKind;
  return `${quoted(target.textName)} ${kind}`;
}

/** The action as an instruction a person can follow without reading code. */
function stepSentence(step: RecordedStep): string {
  switch (step.action) {
    case 'navigate':
      return `Open ${step.value ?? step.url}`;
    case 'click':
      return `Click ${elementPhrase(step)}`;
    case 'dblclick':
      return `Double-click ${elementPhrase(step)}`;
    case 'fill':
      return `Enter the test data in ${elementPhrase(step)}`;
    case 'select':
      return `Select the given option in ${elementPhrase(step)}`;
    case 'check':
      return `Tick ${elementPhrase(step)}`;
    case 'uncheck':
      return `Untick ${elementPhrase(step)}`;
    case 'press':
      return `Press ${step.key ?? 'Enter'} in ${elementPhrase(step)}`;
    case 'submit':
      return `Submit ${elementPhrase(step)}`;
    default:
      return `Verify ${elementPhrase(step)}`;
  }
}

/** An assertion as an expectation, phrased for the Expected Result column. */
function expectationSentence(step: RecordedStep): string {
  const element = elementPhrase(step);
  switch (step.action) {
    case 'assertText':
      return `${element} shows "${step.value ?? ''}"`;
    case 'assertValue':
      return `${element} contains "${step.value ?? ''}"`;
    case 'assertVisible':
      return `${element} is visible`;
    case 'assertHidden':
      return `${element} is not visible`;
    case 'assertUrl':
      return `The page URL is ${step.value ?? ''}`;
    default:
      return `${element} is as expected`;
  }
}

function testDataCell(step: RecordedStep): string {
  // A variable reference keeps the fixed test phone number and password out of a
  // Jira ticket that the whole company can read.
  if (step.variable) return `\${${step.variable}}`;
  if (step.sensitive) return '${TEST_PASSWORD}';
  return step.value ?? '';
}

interface ZephyrStep {
  sentence: string;
  testData: string;
  expected: string[];
}

/**
 * Actions become steps; the assertions that follow an action become that step's
 * expected result. A leading assertion, with no action before it, becomes a
 * verification step of its own rather than being dropped.
 */
function foldSteps(steps: RecordedStep[]): ZephyrStep[] {
  const folded: ZephyrStep[] = [];

  for (const step of steps) {
    if (isAssertion(step.action)) {
      const previous = folded[folded.length - 1];
      if (previous) previous.expected.push(expectationSentence(step));
      else {
        folded.push({
          sentence: `Verify: ${expectationSentence(step)}`,
          testData: '',
          expected: [expectationSentence(step)],
        });
      }
      continue;
    }

    folded.push({
      sentence: stepSentence(step),
      testData: testDataCell(step),
      expected: [],
    });
  }

  return folded;
}

function objectiveFor(session: Session, variables: string[]): string {
  const assertions = session.steps.filter((step) => isAssertion(step.action)).length;
  const parts = [
    `Recorded with QA Plugin on ${new Date(session.startedAt).toISOString().slice(0, 10)}.`,
    `${session.steps.length} recorded actions, ${assertions} assertion${assertions === 1 ? '' : 's'}.`,
  ];
  if (variables.length) {
    parts.push(`Test data required: ${variables.join(', ')}.`);
  }
  const errors = session.issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    // Worth carrying across: whoever runs this case should know the flow was
    // already throwing errors when it was recorded.
    parts.push(
      `${errors.length} error(s) detected while recording, e.g. ${errors[0]!.message}`,
    );
  }
  return parts.join(' ');
}

export function zephyrTable(sessions: Session[]): Table {
  const rows: (string | number)[][] = [];

  for (const session of sessions) {
    const variables = [
      ...new Set(
        session.steps
          .map((step) => step.variable ?? (step.sensitive ? 'TEST_PASSWORD' : undefined))
          .filter((name): name is string => !!name),
      ),
    ].sort();

    // The opening navigation is a precondition, not a test step.
    const [first, ...rest] = session.steps;
    const leadingNavigation = first?.action === 'navigate' ? first : undefined;
    const body = leadingNavigation ? rest : session.steps;

    const precondition = leadingNavigation
      ? `Open ${leadingNavigation.value ?? leadingNavigation.url}`
      : '';

    const folded = foldSteps(body);
    if (folded.length === 0) continue;

    folded.forEach((step, index) => {
      // Zephyr Scale groups consecutive rows into one test case: the case-level
      // fields appear on the first row only, and each later row adds a step.
      const isFirst = index === 0;
      rows.push([
        isFirst ? session.title : '',
        isFirst ? objectiveFor(session, variables) : '',
        isFirst ? precondition : '',
        '', // Folder — left for the team to fill in or map on import
        '', // Priority
        '', // Status
        step.sentence,
        step.testData,
        step.expected.join('\n'),
      ]);
    });
  }

  return { name: 'Test Cases', headers: STEP_COLUMNS, rows };
}

export function toZephyrCsv(sessions: Session[]): string {
  return tableToCsv(zephyrTable(sessions));
}

export function toZephyrXlsx(sessions: Session[]): Uint8Array {
  return buildXlsx([zephyrTable(sessions)]);
}

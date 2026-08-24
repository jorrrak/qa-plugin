import { EXACT_TEXT_LIMIT, isAssertion, type RecordedStep, type Session, type TargetInfo } from '../types';
import {
  ariaRole,
  commentOut,
  describeTarget,
  frameSelector,
  indent,
  js,
  requiredVariables,
  valueExpr,
  unresolvedFrameNote,
  type CodegenOptions,
} from './shared';

/**
 * Playwright's frameLocator chains cleanly, and every `getBy*` method exists on
 * a FrameLocator too — so frame support costs nothing but the prefix.
 */
function scope(step: RecordedStep, options: CodegenOptions): string {
  const path = step.framePath ?? [];
  return path.reduce(
    (acc, ref) => `${acc}.frameLocator(${js(frameSelector(ref, options))})`,
    'page',
  );
}

function locator(step: RecordedStep, options: CodegenOptions): string {
  const target = step.target!;
  const root = scope(step, options);

  if (options.locatorStrategy === 'xpath') {
    return `${root}.locator(${js(`xpath=${target.xpath}`)})`;
  }
  if (options.locatorStrategy === 'css') {
    return `${root}.locator(${js(target.cssSelector)})`;
  }

  if (target.testId) return `${root}.getByTestId(${js(target.testId)})`;

  const role = ariaRole(target);
  if (role && target.textName) {
    return `${root}.getByRole(${js(role)}, { name: ${js(target.textName)} })`;
  }
  if (target.ariaLabel) return `${root}.getByLabel(${js(target.ariaLabel)})`;

  return `${root}.locator(${js(`xpath=${target.xpath}`)})`;
}

function statement(step: RecordedStep, options: CodegenOptions): string[] {
  const lines: string[] = [];
  if (step.note) lines.push(`// ${step.note}`);

  if (step.action === 'navigate') {
    lines.push(`await page.goto(${js(step.value ?? step.url)});`);
    return lines;
  }

  if (step.action === 'assertUrl') {
    lines.push(`await expect(page).toHaveURL(${js(step.value ?? '')});`);
    return lines;
  }

  if (!step.target) return lines;

  const frameWarning = unresolvedFrameNote(step.framePath);
  if (frameWarning) {
    // An empty frameLocator('') is worse than no code: it throws and takes the
    // whole test with it. Emit the action commented out — as it would look
    // without the frame wrapper — so the file still runs and the gap is visible.
    return [
      `// ${frameWarning}`,
      ...commentOut(statement({ ...step, framePath: undefined }, options), '//'),
    ];
  }

  const loc = locator(step, options);
  // Keeping the XPath in a comment means the reader can always cross-check the
  // generated locator against what was actually recorded.
  if (options.locatorStrategy === 'smart' && !loc.includes('xpath=')) {
    lines.push(`// ${describeTarget(step.target)} — xpath: ${step.target.xpath}`);
  }

  switch (step.action) {
    case 'click':
      lines.push(`await ${loc}.click();`);
      break;
    case 'dblclick':
      lines.push(`await ${loc}.dblclick();`);
      break;
    case 'fill':
      lines.push(`await ${loc}.fill(${valueExpr(step, 'js')});`);
      break;
    case 'select':
      lines.push(`await ${loc}.selectOption(${valueExpr(step, 'js')});`);
      break;
    case 'check':
      lines.push(`await ${loc}.check();`);
      break;
    case 'uncheck':
      lines.push(`await ${loc}.uncheck();`);
      break;
    case 'press':
      lines.push(`await ${loc}.press(${js(step.key ?? 'Enter')});`);
      break;
    case 'submit':
      lines.push(`await ${loc}.press("Enter");`);
      break;
    case 'assertText': {
      const text = step.value ?? '';
      // Equality on a long string breaks on any incidental whitespace or copy
      // tweak, so anything past the limit is asserted as a substring.
      const matcher = text.length > EXACT_TEXT_LIMIT ? 'toContainText' : 'toHaveText';
      lines.push(`await expect(${loc}).${matcher}(${js(text)});`);
      break;
    }
    case 'assertValue':
      lines.push(`await expect(${loc}).toHaveValue(${js(step.value ?? '')});`);
      break;
    case 'assertVisible':
      lines.push(`await expect(${loc}).toBeVisible();`);
      break;
    case 'assertHidden':
      lines.push(`await expect(${loc}).toBeHidden();`);
      break;
  }
  return lines;
}

export function toPlaywright(sessions: Session[], options: CodegenOptions): string {
  const usesExpect = sessions.some((session) =>
    session.steps.some((step) => isAssertion(step.action)),
  );

  // Stating the required variables up front saves the reader from discovering
  // them one failed run at a time.
  const needed = requiredVariables(sessions.flatMap((session) => session.steps));
  const header = needed.length
    ? `// Required environment variables:\n${needed.map((n) => `//   ${n}`).join('\n')}\n\n`
    : '';

  const tests = sessions.map((session) => {
    const body = session.steps.flatMap((step) => statement(step, options));

    // Errors seen while recording are carried into the file as comments rather
    // than as assertions: turning a bug into a passing assertion would freeze it.
    const errors = session.issues.filter((issue) => issue.severity === 'error');
    const notes = errors.length
      ? [
          '',
          `// ${errors.length} error(s) were detected while recording this flow:`,
          ...errors.slice(0, 5).map((issue) => `//   [${issue.kind}] ${issue.message}`),
        ]
      : [];

    const name = session.title || options.testName;
    return `test(${js(name)}, async ({ page }) => {\n${indent([...body, ...notes], 2)}\n});`;
  });

  return `${header}import { test${usesExpect ? ', expect' : ''} } from '@playwright/test';

${tests.join('\n\n')}
`;
}

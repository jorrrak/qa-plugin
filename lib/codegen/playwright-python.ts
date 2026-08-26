import {
  EXACT_TEXT_LIMIT,
  isAssertion,
  type RecordedStep,
  type Session,
} from '../types';
import {
  ariaRole,
  commentOut,
  frameSelector,
  indent,
  missingNavigationNote,
  py,
  pythonIdentifier,
  relativeToBase,
  requiredVariables,
  uniqueIdentifier,
  unresolvedFrameNote,
  valueExpr,
  type CodegenOptions,
} from './shared';

/**
 * Playwright for Python, in the shape `playwright codegen --target python` emits:
 * the synchronous API driven from a `run(playwright)` function.
 *
 * Not a pytest module on purpose. This is the form a tester runs directly with
 * `python flow.py` to watch the browser do it, which is what a freshly recorded
 * flow is for. The pytest form is a different artefact with a different lifecycle.
 */

function locator(step: RecordedStep, options: CodegenOptions): string {
  const target = step.target!;
  const root = scope(step, options);

  if (options.locatorStrategy === 'xpath') {
    return `${root}.locator(${py(`xpath=${target.xpath}`)})`;
  }
  if (options.locatorStrategy === 'css') {
    return `${root}.locator(${py(target.cssSelector)})`;
  }

  if (target.testId) return `${root}.get_by_test_id(${py(target.testId)})`;

  const role = ariaRole(target);
  if (role && target.textName) {
    return `${root}.get_by_role(${py(role)}, name=${py(target.textName)})`;
  }
  if (target.ariaLabel) return `${root}.get_by_label(${py(target.ariaLabel)})`;

  return `${root}.locator(${py(`xpath=${target.xpath}`)})`;
}

/** `page`, or a chain of frame_locator calls down to the frame the step ran in. */
function scope(step: RecordedStep, options: CodegenOptions): string {
  return (step.framePath ?? []).reduce(
    (acc, ref) => `${acc}.frame_locator(${py(frameSelector(ref, options))})`,
    'page',
  );
}

function gotoExpression(step: RecordedStep, options: CodegenOptions): string {
  const url = step.value ?? step.url;
  const path = relativeToBase(url, options.baseUrl);
  return path ? `os.environ["BASE_URL"] + ${py(path)}` : py(url);
}

function statement(step: RecordedStep, options: CodegenOptions): string[] {
  const lines: string[] = [];
  if (step.note) lines.push(`# ${step.note}`);

  if (step.action === 'navigate') {
    lines.push(`page.goto(${gotoExpression(step, options)})`);
    return lines;
  }

  if (step.action === 'scrollToBottom') {
    const rounds = Math.max(2, (step.repeat ?? 1) + 2);
    lines.push(
      `# Load more by scrolling. Recorded ${step.repeat ?? 1} round(s); stops early once the list stops growing.`,
      `previous_height = 0`,
      `for _ in range(${rounds}):`,
      `    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")`,
      `    page.wait_for_timeout(600)`,
      `    height = page.evaluate("document.body.scrollHeight")`,
      `    if height == previous_height:`,
      `        break`,
      `    previous_height = height`,
    );
    return lines;
  }

  if (step.action === 'assertTextPresent') {
    // `.first` is a property in Python, not a method as it is in the JS API — and
    // it is needed for the same reason: get_by_text can match several nodes and
    // strict mode would raise instead of asserting.
    lines.push(
      `expect(${scope(step, options)}.get_by_text(${py(step.value ?? '')}).first).to_be_visible()`,
    );
    return lines;
  }

  if (step.action === 'assertUrl') {
    const path = relativeToBase(step.value ?? '', options.baseUrl);
    lines.push(
      `expect(page).to_have_url(${
        path ? `os.environ["BASE_URL"] + ${py(path)}` : py(step.value ?? '')
      })`,
    );
    return lines;
  }

  if (!step.target) return lines;

  const frameWarning = unresolvedFrameNote(step.framePath);
  if (frameWarning) {
    // An empty frame_locator("") raises rather than failing usefully, so the
    // action is commented out minus its unusable frame wrapper.
    return [
      `# ${frameWarning}`,
      ...commentOut(statement({ ...step, framePath: undefined }, options), '#'),
    ];
  }

  const loc = locator(step, options);

  switch (step.action) {
    case 'click':
      lines.push(`${loc}.click()`);
      break;
    case 'dblclick':
      lines.push(`${loc}.dblclick()`);
      break;
    case 'fill':
      lines.push(
        step.typeSequentially
          ? `${loc}.press_sequentially(${valueExpr(step, 'python')})`
          : `${loc}.fill(${valueExpr(step, 'python')})`,
      );
      break;
    case 'scrollTo':
      lines.push(`${loc}.scroll_into_view_if_needed()`);
      break;
    case 'select':
      lines.push(`${loc}.select_option(${valueExpr(step, 'python')})`);
      break;
    case 'check':
      lines.push(`${loc}.check()`);
      break;
    case 'uncheck':
      lines.push(`${loc}.uncheck()`);
      break;
    case 'press':
      lines.push(`${loc}.press(${py(step.key ?? 'Enter')})`);
      break;
    case 'submit':
      lines.push(`${loc}.press("Enter")`);
      break;
    case 'assertText': {
      const text = step.value ?? '';
      // Equality on a long string breaks on any incidental whitespace or copy
      // edit, so anything past the limit is asserted as a substring.
      const matcher = text.length > EXACT_TEXT_LIMIT ? 'to_contain_text' : 'to_have_text';
      lines.push(`expect(${loc}).${matcher}(${py(text)})`);
      break;
    }
    case 'assertValue':
      lines.push(`expect(${loc}).to_have_value(${py(step.value ?? '')})`);
      break;
    case 'assertVisible':
      lines.push(`expect(${loc}).to_be_visible()`);
      break;
    case 'assertHidden':
      lines.push(`expect(${loc}).to_be_hidden()`);
      break;
  }
  return lines;
}

function functionFor(
  session: Session,
  name: string,
  options: CodegenOptions,
): string {
  const warning = missingNavigationNote(session.steps);
  const body = [
    ...(warning ? [`# ${warning}`] : []),
    ...session.steps.flatMap((step) => statement(step, options)),
  ];

  const errors = session.issues.filter((issue) => issue.severity === 'error');
  const notes = errors.length
    ? [
        '',
        `# ${errors.length} error(s) were detected while recording this flow:`,
        ...errors.slice(0, 5).map((issue) => `#   [${issue.kind}] ${issue.message}`),
      ]
    : [];

  // The title may be unrepresentable in the identifier, so it lives here.
  const docstring = session.title ? `    """${session.title.replace(/"/g, "'")}"""\n` : '';

  return `def ${name}(playwright: Playwright) -> None:
${docstring}    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
${indent([...body, ...notes], 4)}

    # ---------------------
    context.close()
    browser.close()`;
}

export function toPlaywrightPython(
  sessions: Session[],
  options: CodegenOptions,
): string {
  const allSteps = sessions.flatMap((session) => session.steps);
  const needed = requiredVariables(allSteps, options.baseUrl);
  const usesExpect = sessions.some((session) =>
    session.steps.some((step) => isAssertion(step.action)),
  );

  const header = needed.length
    ? `# Required environment variables:\n${needed.map((n) => `#   ${n}`).join('\n')}\n\n`
    : '';

  // Unused imports are a lint failure in most Python projects, so `os` and
  // `expect` appear only when the generated body actually uses them. Playwright's
  // own codegen emits both unconditionally.
  const imports = [
    needed.length ? 'import os\n' : '',
    `from playwright.sync_api import Playwright, sync_playwright${usesExpect ? ', expect' : ''}`,
  ]
    .filter(Boolean)
    .join('\n');

  const single = sessions.length === 1;
  const taken = new Set<string>();
  const functions = sessions.map((session, index) => {
    const name = single
      ? 'run'
      : uniqueIdentifier(`run_${pythonIdentifier(session.title, index)}`, taken);
    return { name, code: functionFor(session, name, options) };
  });

  const calls = functions.map((fn) => `    ${fn.name}(playwright)`).join('\n');

  return `${header}${imports}


${functions.map((fn) => fn.code).join('\n\n\n')}


with sync_playwright() as playwright:
${calls}
`;
}

import { EXACT_TEXT_LIMIT, type RecordedStep, type Session, type TargetInfo } from '../types';
import {
  commentOut,
  cypressValueExpr,
  describeTarget,
  frameSelector,
  indent,
  missingNavigationNote,
  relativeToBase,
  js,
  requiredVariables,
  unresolvedFrameNote,
  type CodegenOptions,
} from './shared';

/**
 * The query without its `cy.` prefix, so it can be re-rooted onto an iframe.
 * Which command it is matters: `.find()` takes a selector, `.contains()` takes a
 * tag plus text, and they are not interchangeable.
 */
function query(target: TargetInfo, options: CodegenOptions): { command: string; args: string } {
  if (options.locatorStrategy === 'xpath') {
    return { command: 'xpath', args: js(target.xpath) };
  }
  if (options.locatorStrategy === 'css') {
    return { command: 'get', args: js(target.cssSelector) };
  }
  if (target.testId) {
    return { command: 'get', args: js(`[data-testid="${target.testId}"]`) };
  }
  if (target.textName && (target.elementKind === 'button' || target.elementKind === 'link')) {
    return { command: 'contains', args: `${js(target.tagName)}, ${js(target.textName)}` };
  }
  return { command: 'get', args: js(target.cssSelector) };
}

/**
 * Cypress cannot cross an iframe boundary on its own: `cy.iframe()` comes from
 * the cypress-iframe plugin and handles a single level. Anything deeper gets a
 * FIXME rather than code that looks right and fails at run time.
 */
function rootedLocator(
  step: RecordedStep,
  options: CodegenOptions,
): { code: string; warnings: string[] } {
  const target = step.target!;
  const { command, args } = query(target, options);
  const path = step.framePath ?? [];

  if (path.length === 0) {
    return { code: `cy.${command}(${args})`, warnings: [] };
  }

  const warnings: string[] = [];
  const frame = `cy.iframe(${js(frameSelector(path[0]!, options))})`;

  // cypress-xpath does not chain off a yielded iframe body, so inside a frame the
  // CSS selector is used regardless of the chosen strategy.
  if (command === 'xpath') {
    warnings.push('cypress-xpath cannot scope into an iframe — using the CSS selector here.');
    return { code: `${frame}.find(${js(target.cssSelector)})`, warnings };
  }

  // `.contains()` chains off the frame body directly; `.get()` becomes `.find()`.
  const chained = command === 'contains' ? `contains(${args})` : `find(${args})`;
  return { code: `${frame}.${chained}`, warnings };
}

/**
 * The scrollable container a scroll step happened in, as a Cypress query. The
 * iframe rooting is reused wholesale: a scrolling list inside an iframe is not
 * a special case, it is the same element lookup with a different field.
 */
function containerQuery(
  step: RecordedStep,
  options: CodegenOptions,
): string | undefined {
  if (!step.scrollContainer) return undefined;
  return rootedLocator({ ...step, target: step.scrollContainer }, options).code;
}

/**
 * Cypress spells keys as `{enter}` and modifiers as `{ctrl}`, and a combination
 * is written as the modifiers followed by the key — `{ctrl}a`, not `{ctrl+a}`.
 */
function cypressKeys(key: string): string {
  const MODIFIERS: Record<string, string> = {
    Control: '{ctrl}',
    Meta: '{cmd}',
    Alt: '{alt}',
    Shift: '{shift}',
  };
  const parts = key.split('+');
  const base = parts.pop() ?? 'Enter';
  const prefix = parts.map((m) => MODIFIERS[m] ?? '').join('');
  // The letter must stay lowercase. Typing an uppercase letter in Cypress implies
  // Shift, so `{ctrl}A` would send Ctrl+Shift+A; Shift is expressed as `{shift}`.
  return prefix + (base.length === 1 ? base.toLowerCase() : `{${base.toLowerCase()}}`);
}

function statement(step: RecordedStep, options: CodegenOptions): string[] {
  const lines: string[] = [];
  if (step.note) lines.push(`// ${step.note}`);

  if (step.action === 'navigate') {
    const url = step.value ?? step.url;
    const path = relativeToBase(url, options.baseUrl);
    lines.push(
      path
        ? `cy.visit(Cypress.env("BASE_URL") + ${js(path)});`
        : `cy.visit(${js(url)});`,
    );
    return lines;
  }
  if (step.action === 'scrollPosition') {
    const y = step.scrollOffset ?? 0;
    const container = containerQuery(step, options);
    lines.push(container ? `${container}.scrollTo(0, ${y});` : `cy.scrollTo(0, ${y});`);
    return lines;
  }

  if (step.action === 'scrollToBottom') {
    const rounds = step.repeat ?? 1;
    const container = containerQuery(step, options);
    // Cypress queues commands rather than running them inline, so a
    // "stop when it stops growing" loop is not expressible here. The recorded
    // count is repeated instead, which is exactly what the tester did.
    lines.push(
      `// Load more by scrolling, ${rounds} round(s) as recorded.`,
      `Cypress._.times(${rounds}, () => {`,
      container ? `  ${container}.scrollTo('bottom');` : `  cy.scrollTo('bottom');`,
      `  cy.wait(600);`,
      `});`,
    );
    return lines;
  }

  if (step.action === 'assertTextPresent') {
    const path = step.framePath ?? [];
    // cy.contains yields the first match on its own, so no .first() is needed.
    const root =
      path.length === 1
        ? `cy.iframe(${js(frameSelector(path[0]!, options))}).contains(`
        : 'cy.contains(';
    if (path.length > 1) {
      lines.push(
        `// FIXME: ${path.length} nested iframes — cypress-iframe handles one level only.`,
      );
    }
    lines.push(`${root}${js(step.value ?? '')}).should("be.visible");`);
    return lines;
  }

  if (step.action === 'assertUrl') {
    lines.push(`cy.url().should("eq", ${js(step.value ?? '')});`);
    return lines;
  }
  if (!step.target) return lines;

  const path = step.framePath ?? [];

  const frameWarning = unresolvedFrameNote(step.framePath);
  if (frameWarning) {
    // cy.iframe('') would fail the whole spec; comment the action out instead.
    return [
      `// ${frameWarning}`,
      ...commentOut(statement({ ...step, framePath: undefined }, options), '//'),
    ];
  }

  if (path.length > 1) {
    // Emitting cy.iframe() for only the outermost frame would silently search the
    // wrong document. A commented-out action plus the chain is honest; code that
    // looks right and targets the wrong frame is not.
    return [
      `// FIXME: ${path.length} nested iframes — cypress-iframe handles one level only.`,
      `// Frame chain: ${path.map((ref) => frameSelector(ref, options)).join(' > ')}`,
      ...commentOut(statement({ ...step, framePath: undefined }, options), '//'),
    ];
  }

  const { code: loc, warnings } = rootedLocator(step, options);
  for (const warning of warnings) lines.push(`// ${warning}`);

  if (options.locatorStrategy !== 'xpath') {
    lines.push(`// ${describeTarget(step.target)} — xpath: ${step.target.xpath}`);
  }

  switch (step.action) {
    case 'click':
      lines.push(`${loc}.click();`);
      break;
    case 'dblclick':
      lines.push(`${loc}.dblclick();`);
      break;
    case 'fill': {
      const { expr, quiet } = cypressValueExpr(step);
      lines.push(`${loc}.clear().type(${expr}${quiet ? ', { log: false }' : ''});`);
      break;
    }
    case 'select':
      lines.push(`${loc}.select(${cypressValueExpr(step).expr});`);
      break;
    case 'scrollTo':
      lines.push(`${loc}.scrollIntoView();`);
      break;
    case 'check':
      lines.push(`${loc}.check();`);
      break;
    case 'uncheck':
      lines.push(`${loc}.uncheck();`);
      break;
    case 'press':
      lines.push(`${loc}.type(${js(cypressKeys(step.key ?? 'Enter'))});`);
      break;
    case 'submit':
      lines.push(`${loc}.type("{enter}");`);
      break;
    case 'assertText': {
      const text = step.value ?? '';
      const matcher = text.length > EXACT_TEXT_LIMIT ? 'contain.text' : 'have.text';
      lines.push(`${loc}.should(${js(matcher)}, ${js(text)});`);
      break;
    }
    case 'assertValue':
      lines.push(`${loc}.should("have.value", ${js(step.value ?? '')});`);
      break;
    case 'assertVisible':
      lines.push(`${loc}.should("be.visible");`);
      break;
    case 'assertHidden':
      lines.push(`${loc}.should("not.be.visible");`);
      break;
  }
  return lines;
}

export function toCypress(sessions: Session[], options: CodegenOptions): string {
  const usesFrames = sessions.some((session) =>
    session.steps.some((step) => (step.framePath?.length ?? 0) > 0),
  );

  const needed = requiredVariables(
    sessions.flatMap((session) => session.steps),
    options.baseUrl,
  );
  const envNote = needed.length
    ? `// Required Cypress env values (cypress.env.json or CYPRESS_* in the shell):\n${needed
        .map((n) => `//   ${n}`)
        .join('\n')}`
    : null;

  const plugins = [
    options.locatorStrategy === 'xpath'
      ? "// Requires cypress-xpath: npm i -D cypress-xpath\n// then add `import 'cypress-xpath';` to cypress/support/e2e.js"
      : null,
    usesFrames
      ? "// Requires cypress-iframe: npm i -D cypress-iframe\n// then add `import 'cypress-iframe';` to cypress/support/e2e.js"
      : null,
    envNote,
  ].filter(Boolean);

  const header = plugins.length ? `${plugins.join('\n')}\n\n` : '';

  const tests = sessions.map((session) => {
    const warning = missingNavigationNote(session.steps);
    const body = [
      ...(warning ? [`// ${warning}`] : []),
      ...session.steps.flatMap((step) => statement(step, options)),
    ];
    const name = session.title || options.testName;
    return `  it(${js(name)}, () => {\n${indent(body, 4)}\n  });`;
  });

  const suiteName =
    sessions.length === 1 ? (sessions[0]?.title ?? options.testName) : options.testName;

  return `${header}describe(${js(suiteName)}, () => {
${tests.join('\n\n')}
});
`;
}

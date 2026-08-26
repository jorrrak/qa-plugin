import { xpathLiteral } from '../selector-engine/xpath';
import { EXACT_TEXT_LIMIT, type RecordedStep, type Session, type TargetInfo } from '../types';
import {
  commentOut,
  describeTarget,
  frameSelector,
  indent,
  missingNavigationNote,
  relativeToBase,
  py,
  pythonIdentifier,
  requiredVariables,
  samePath,
  uniqueIdentifier,
  valueExpr,
  unresolvedFrameNote,
  type CodegenOptions,
} from './shared';

function by(target: TargetInfo, options: CodegenOptions): string {
  if (options.locatorStrategy === 'css') {
    return `By.CSS_SELECTOR, ${py(target.cssSelector)}`;
  }
  if (options.locatorStrategy === 'smart' && target.testId) {
    return `By.CSS_SELECTOR, ${py(`[data-testid="${target.testId}"]`)}`;
  }
  return `By.XPATH, ${py(target.xpath)}`;
}

/**
 * Every interaction goes through an explicit wait. A recorded script without
 * waits passes on the machine that recorded it and fails everywhere else.
 */
function findExpr(target: TargetInfo, options: CodegenOptions, clickable: boolean): string {
  const condition = clickable ? 'element_to_be_clickable' : 'visibility_of_element_located';
  return `wait.until(EC.${condition}((${by(target, options)})))`;
}

/**
 * Selenium has no frame-scoped locator: the driver has a single current frame and
 * you switch into it. Descending from `default_content()` every time is more
 * verbose than tracking relative moves, but it is always correct — and a wrong
 * frame produces a NoSuchElementException that is miserable to debug.
 */
function frameSwitch(step: RecordedStep, options: CodegenOptions): string[] {
  const path = step.framePath ?? [];
  const lines = ['driver.switch_to.default_content()'];
  for (const ref of path) {
    const by =
      options.locatorStrategy === 'xpath'
        ? `By.XPATH, ${py(ref.xpath)}`
        : `By.CSS_SELECTOR, ${py(ref.selector)}`;
    lines.push(`driver.switch_to.frame(wait.until(EC.presence_of_element_located((${by}))))`);
  }
  return lines;
}

/** Selenium's Keys constants are SCREAMING_SNAKE: ArrowLeft -> ARROW_LEFT. */
function seleniumKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function statement(step: RecordedStep, options: CodegenOptions): string[] {
  const lines: string[] = [];
  if (step.note) lines.push(`# ${step.note}`);

  const frameWarning = unresolvedFrameNote(step.framePath);
  if (frameWarning) {
    // `By.XPATH, ""` raises InvalidSelectorException and kills the run, so the
    // action is commented out instead, minus its unusable frame switch.
    return [
      `# ${frameWarning}`,
      ...commentOut(statement({ ...step, framePath: undefined }, options), '#'),
    ];
  }

  if (step.action === 'navigate') {
    const url = step.value ?? step.url;
    const path = relativeToBase(url, options.baseUrl);
    lines.push(
      path
        ? `driver.get(os.environ["BASE_URL"] + ${py(path)})`
        : `driver.get(${py(url)})`,
    );
    return lines;
  }
  if (step.action === 'scrollToBottom') {
    const rounds = Math.max(2, (step.repeat ?? 1) + 2);
    lines.push(
      `# Load more by scrolling. Recorded ${step.repeat ?? 1} round(s); stops early once the list stops growing.`,
      `_previous_height = 0`,
      `for _ in range(${rounds}):`,
      `    driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")`,
      `    time.sleep(0.6)`,
      `    _height = driver.execute_script("return document.body.scrollHeight")`,
      `    if _height == _previous_height:`,
      `        break`,
      `    _previous_height = _height`,
    );
    return lines;
  }

  if (step.action === 'assertTextPresent') {
    // The text ends up inside an XPath literal inside a Python literal, so it
    // needs XPath quoting first — `py()` alone would produce a valid Python
    // string containing a broken XPath.
    const literal = xpathLiteral(step.value ?? '');
    if (!literal) {
      lines.push(
        `# FIXME: the expected text contains both quote characters, which XPath 1.0`,
        `#        cannot express in one literal. Assert it by another means:`,
        `#        ${(step.value ?? '').slice(0, 80)}`,
      );
      return lines;
    }
    // `text()[contains(...)]` matches only elements holding the text directly.
    // `contains(., ...)` would also match <html> and <body>, which always pass.
    const xpath = `//*[text()[contains(normalize-space(.), ${literal})]]`;
    lines.push(
      `wait.until(EC.visibility_of_element_located((By.XPATH, ${py(xpath)})))`,
    );
    return lines;
  }

  if (step.action === 'assertUrl') {
    lines.push(`assert driver.current_url == ${py(step.value ?? '')}, driver.current_url`);
    return lines;
  }
  if (!step.target) return lines;

  lines.push(`# ${describeTarget(step.target)}`);

  switch (step.action) {
    case 'click':
    case 'check':
    case 'uncheck':
      lines.push(`${findExpr(step.target, options, true)}.click()`);
      break;
    case 'dblclick':
      lines.push(`_el = ${findExpr(step.target, options, true)}`);
      lines.push('ActionChains(driver).double_click(_el).perform()');
      break;
    case 'fill':
      lines.push(`_el = ${findExpr(step.target, options, false)}`);
      lines.push('_el.clear()');
      lines.push(`_el.send_keys(${valueExpr(step, 'python')})`);
      break;
    case 'select':
      lines.push(
        `Select(${findExpr(step.target, options, false)}).select_by_value(${valueExpr(step, 'python')})`,
      );
      break;
    case 'press':
    case 'submit': {
      const key = step.key ?? 'Enter';
      const parts = key.split('+');
      const base = parts.pop() ?? 'Enter';
      if (parts.length > 0) {
        // A held modifier cannot be expressed with send_keys alone.
        lines.push(`_el = ${findExpr(step.target, options, false)}`);
        const chain = parts.map((m) => `.key_down(Keys.${m.toUpperCase()})`).join('');
        const release = parts
          .slice()
          .reverse()
          .map((m) => `.key_up(Keys.${m.toUpperCase()})`)
          .join('');
        const send = base.length === 1 ? py(base.toLowerCase()) : `Keys.${seleniumKey(base)}`;
        lines.push('_el.click()  # focus the element the keys are sent to');
        lines.push(`ActionChains(driver)${chain}.send_keys(${send})${release}.perform()`);
      } else {
        lines.push(
          `${findExpr(step.target, options, false)}.send_keys(Keys.${seleniumKey(base)})`,
        );
      }
      break;
    }
    case 'scrollTo':
      // scroll_to_element exists only on newer Selenium; the script form works
      // everywhere and is what most suites already use.
      lines.push(
        `driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", ${findExpr(step.target, options, false)})`,
      );
      break;
    case 'assertText': {
      const text = step.value ?? '';
      lines.push(`_el = ${findExpr(step.target, options, false)}`);
      lines.push(
        text.length > EXACT_TEXT_LIMIT
          ? `assert ${py(text)} in _el.text, _el.text`
          : `assert _el.text.strip() == ${py(text)}, _el.text`,
      );
      break;
    }
    case 'assertValue':
      lines.push(
        `assert ${findExpr(step.target, options, false)}.get_attribute("value") == ${py(step.value ?? '')}`,
      );
      break;
    case 'assertVisible':
      // The explicit wait *is* the assertion: it raises TimeoutException if the
      // element never becomes visible.
      lines.push(`${findExpr(step.target, options, false)}`);
      break;
    case 'assertHidden':
      lines.push(
        `wait.until(EC.invisibility_of_element_located((${by(step.target, options)})))`,
      );
      break;
  }
  return lines;
}

export function toSeleniumPython(sessions: Session[], options: CodegenOptions): string {
  const needed = requiredVariables(
    sessions.flatMap((session) => session.steps),
    options.baseUrl,
  );
  const needsOs = needed.length > 0;
  const needsTime = sessions.some((session) =>
    session.steps.some((step) => step.action === 'scrollToBottom'),
  );
  const header = needsOs
    ? `# Required environment variables:\n${needed.map((n) => `#   ${n}`).join('\n')}\n`
    : '';

  const seen = new Set<string>();
  const functions = sessions.map((session, index) => {
    const base = pythonIdentifier(session.title, index);
    // Two test cases with the same title would collide into one function and the
    // second would silently shadow the first.
    const name = uniqueIdentifier(base, seen);

    // The title may be unrepresentable in the identifier, so it lives here.
    const docstring = session.title ? `    """${session.title.replace(/"/g, "'")}"""\n` : '';
    // Emit a frame switch only when the frame actually changes, so a run of
    // steps inside one iframe does not repeat four lines of boilerplate.
    const warning = missingNavigationNote(session.steps);
    let currentPath: RecordedStep['framePath'] = [];
    const stepLines = session.steps.flatMap((step) => {
      if (step.action === 'navigate') {
        currentPath = [];
        return statement(step, options);
      }
      // A path we could not identify gets no switch at all; the step comes back
      // fully commented out, so the driver's current frame is left untouched.
      if (step.framePath?.some((ref) => ref.unresolved)) return statement(step, options);

      const prefix = samePath(currentPath, step.framePath) ? [] : frameSwitch(step, options);
      currentPath = step.framePath ?? [];
      return [...prefix, ...statement(step, options)];
    });
    const body = warning ? [`# ${warning}`, ...stepLines] : stepLines;

    return `def test_${name}():
${docstring}    driver = webdriver.Chrome()
    wait = WebDriverWait(driver, 10)
    try:
${indent(body, 8)}
    finally:
        driver.quit()`;
  });

  return `${header}${needsOs ? 'import os\n' : ''}${needsTime ? 'import time\n' : ''}from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait


${functions.join('\n\n\n')}
`;
}

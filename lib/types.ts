/** Core data model shared by the recorder, the codegen and the bug detector. */

export type StepAction =
  | 'click'
  | 'dblclick'
  | 'fill'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'press'
  | 'submit'
  | 'navigate'
  /**
   * Scrolling, recorded as an intent rather than a coordinate: the step names an
   * element to bring into view. `window.scrollTo(0, 1200)` would be a number that
   * means something different on every viewport and every content length.
   */
  | 'scrollTo'
  /**
   * The fallback for a scroll over content nothing can name — an image grid, a
   * map, a chart. A pixel offset is genuinely worse than an element, for the
   * reason above, but it is much better than the silence this replaces: the
   * tester scrolled, the recording said nothing, and the generated script then
   * clicked something that had never been rendered.
   */
  | 'scrollPosition'
  /**
   * Scrolling that *loads* content rather than merely revealing it. Recorded
   * separately because the generated step is a loop, not a single action: the
   * test has to keep scrolling until the list stops growing.
   */
  | 'scrollToBottom'
  | AssertAction;

/**
 * Assertions the tester adds by right-clicking an element mid-recording. Without
 * these a recorded script only proves the flow does not crash — it never checks
 * that the right thing happened.
 */
export type AssertAction =
  | 'assertText'
  /**
   * "This text is somewhere on the page." Targets the text rather than an
   * element, so moving the message from an <h2> to a <div> does not break a test
   * that is checking nothing about the markup.
   */
  | 'assertTextPresent'
  | 'assertVisible'
  | 'assertHidden'
  | 'assertValue'
  | 'assertUrl';

export const ASSERT_ACTIONS: readonly AssertAction[] = [
  'assertText',
  'assertTextPresent',
  'assertVisible',
  'assertHidden',
  'assertValue',
  'assertUrl',
];

export function isAssertion(action: StepAction): action is AssertAction {
  return (ASSERT_ACTIONS as readonly string[]).includes(action);
}

/** Text longer than this is asserted with "contains" rather than equality. */
export const EXACT_TEXT_LIMIT = 60;

/** Bound on one test case, so a runaway page cannot fill up extension storage. */
export const MAX_STEPS = 500;

export type ElementKind =
  | 'button'
  | 'link'
  | 'input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'other';

/**
 * Everything we know about the element a step acted on. We deliberately keep
 * several locator flavours instead of picking one: automation frameworks differ
 * in what they prefer, and a QA engineer reading the panel wants the XPath even
 * when the generated script uses a role-based locator.
 */
export interface TargetInfo {
  /** Robust XPath — anchored on an id/test-id ancestor when one exists. */
  xpath: string;
  /** Full structural XPath from the document root. Always unique, always brittle. */
  xpathAbsolute: string;
  /** Text-based XPath, e.g. //button[normalize-space()="Save"]. Undefined when the element has no usable text. */
  xpathByText?: string;
  /** Shortest CSS selector that still matches exactly one element. */
  cssSelector: string;
  /** data-testid / data-test / data-cy, whichever is present. */
  testId?: string;
  /** Visible label a human would use for this element ("Save", "Email address"). */
  textName: string;
  role?: string;
  ariaLabel?: string;
  tagName: string;
  inputType?: string;
  elementKind: ElementKind;
  /** True when the locator matched exactly one node at capture time. */
  unique: boolean;
}

/**
 * One hop of the iframe chain, described from the *parent* document's point of
 * view. A runtime frame id is useless in a generated test, so what gets stored
 * is a locator for the `<iframe>` element itself.
 */
export interface FrameRef {
  /** CSS selector for the iframe element within its parent document. */
  selector: string;
  /** XPath for the same element, for XPath-only codegen. */
  xpath: string;
  name?: string;
  /** The iframe's `src` as the parent declared it. Readability, not targeting. */
  src?: string;
  /**
   * True when the parent never answered the frame's "which iframe am I?" query —
   * typically because no content script could be injected there. The step is
   * still recorded, but the generated locator cannot reach it.
   */
  unresolved?: boolean;
}

export interface RecordedStep {
  id: string;
  seq: number;
  action: StepAction;
  target?: TargetInfo;
  /** Typed text, selected option, or destination URL for `navigate`. */
  value?: string;
  /** Key name for `press`. */
  key?: string;
  url: string;
  timestamp: number;
  /** Set by the user in the panel; becomes a comment in the generated script. */
  note?: string;
  /**
   * True when the value came from a password field and matched no known test
   * variable. The text is never captured; the generated script reads
   * `TEST_PASSWORD` from the environment instead.
   */
  sensitive?: boolean;
  /**
   * Name of the test variable this value came from. Set when the typed text
   * matched a variable defined in the Test data panel — the literal is then
   * never stored, and every export and generated script references the variable
   * instead. This is what keeps one fixed test phone number and password out of
   * fifty recorded scripts.
   */
  variable?: string;
  /**
   * Iframe chain from the top document down to the frame this step happened in.
   * Absent or empty means the top frame.
   */
  framePath?: FrameRef[];
  /**
   * Send the value as individual keystrokes instead of assigning it at once.
   *
   * Set automatically when the characters typed do not match the field's final
   * value — the signature of an input mask. Playwright's `fill()` assigns the
   * value directly, which a masked field never sees, so it has to be typed.
   */
  typeSequentially?: boolean;
  /**
   * Transport and bookkeeping only. While a field is being typed into, each
   * update replaces the previous step instead of appending a new one, so the
   * panel shows the value growing live rather than nothing until blur.
   */
  upsertKey?: string;
  /**
   * How many times the action was repeated while recording. Used by
   * `scrollToBottom`, where the count becomes the loop's upper bound.
   */
  repeat?: number;
  /**
   * Pixel offset for `scrollPosition`. Read together with `target`: with one, it
   * is that container's `scrollTop`; without, the window's `scrollY`.
   */
  scrollOffset?: number;
  /**
   * The scrollable element a scroll step happened in, when it was not the page
   * itself. Half the web scrolls a `div` under a fixed header rather than the
   * document, and a step that ignores that scrolls the wrong thing.
   */
  scrollContainer?: TargetInfo;
}

/**
 * The fields the panel is allowed to change on a recorded step.
 *
 * Deliberately not `Partial<RecordedStep>`: a locator, a frame path and a
 * timestamp are records of what happened, and letting the panel rewrite them
 * would turn "edit this test case" into "fabricate a recording".
 */
export interface StepPatch {
  value?: string;
  key?: string;
  note?: string;
}

export type IssueKind =
  | 'console-error'
  | 'console-warning'
  | 'uncaught-error'
  | 'unhandled-rejection'
  | 'network-failure'
  | 'http-error'
  | 'resource-error';

export interface Issue {
  id: string;
  kind: IssueKind;
  severity: 'error' | 'warning';
  message: string;
  detail?: string;
  stack?: string;
  url: string;
  timestamp: number;
  /**
   * The step that was recorded immediately before this issue appeared. This is
   * the whole point of running the recorder and the detector off one clock:
   * it turns "there is an error in the console" into "clicking Save breaks".
   */
  nearStepId?: string;
  /** How many times an identical issue was seen. Identical issues are collapsed. */
  count: number;
}

export interface Session {
  id: string;
  tabId: number;
  title: string;
  startedAt: number;
  recording: boolean;
  steps: RecordedStep[];
  issues: Issue[];
  /** Monotonic counter so step numbering survives a service-worker restart. */
  nextSeq: number;
}

export function emptySession(tabId: number, title = 'Untitled test case'): Session {
  return {
    id: `s_${tabId}_${Date.now().toString(36)}`,
    tabId,
    title,
    startedAt: Date.now(),
    recording: false,
    steps: [],
    issues: [],
    nextSeq: 1,
  };
}

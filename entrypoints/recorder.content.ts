import { defineContentScript } from 'wxt/utils/define-content-script';
import { uid } from '@/lib/id';
import { framePath, serveFramePathQueries } from '@/lib/frame-path';
import { sendMessage, type Message } from '@/lib/messaging';
import { describeElement, resolveInteractive, shortName } from '@/lib/selector-engine';
import { matchVariable, type TestVariable } from '@/lib/variables';
import { EXACT_TEXT_LIMIT, type AssertAction, type IssueKind, type RecordedStep, type StepAction } from '@/lib/types';

/** Payload shape the MAIN-world probe posts over window.postMessage. */
interface ProbeReport {
  source: 'qa-plugin-probe';
  kind: IssueKind;
  severity: 'error' | 'warning';
  message: string;
  detail?: string;
  stack?: string;
}

function isProbeReport(data: unknown): data is ProbeReport {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === 'qa-plugin-probe'
  );
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  // Every frame, so a click inside a payment or SSO iframe is recorded rather
  // than silently dropped. Each step carries the iframe chain it happened in.
  allFrames: true,

  main() {
    let recording = false;
    /** Test data, pushed by the background and refreshed when it is edited. */
    let variables: TestVariable[] = [];
    /** Pending single click, held briefly so a double-click can replace it. */
    let pendingClick: { step: Omit<RecordedStep, 'seq'>; timer: number } | null = null;

    const DBLCLICK_WINDOW_MS = 220;

    const isTopFrame = window.top === window;

    /**
     * The element has to be described synchronously, while the handler is still
     * running and the DOM still matches what the user saw. The frame path is
     * attached afterwards from cache. Every step awaits the same cached promise,
     * so microtask ordering keeps them in the order they happened.
     */
    function emit(step: Omit<RecordedStep, 'seq'>): void {
      // Anything but a scroll counts as an action the page may scroll in response
      // to, which is what the scroll filter waits out.
      if (step.action !== 'scrollTo' && step.action !== 'scrollToBottom') {
        lastActionAt = Date.now();
      }
      // A different action means the next load-more scroll is a new sequence.
      if (step.action !== 'scrollToBottom') bottomRuns = 0;
      void framePath().then((path) => {
        void sendMessage({
          type: 'step',
          step: path.length ? { ...step, framePath: path } : step,
        });
      });
    }

    function build(
      action: StepAction,
      el: Element,
      extra: Partial<RecordedStep> = {},
    ): Omit<RecordedStep, 'seq'> {
      return {
        id: uid('step'),
        action,
        target: describeElement(el),
        url: location.href,
        timestamp: Date.now(),
        ...extra,
      };
    }

    /* ---- typing: live updates, and mask detection ---------------------- */

    /** Identity for a field across keystrokes, stable within one document. */
    function elementKey(el: Element): string {
      return describeElement(el).xpath;
    }

    /** What the user actually pressed, per field, to compare against the result. */
    const typedBuffers = new Map<string, string>();
    const liveTimers = new Map<string, number>();

    function recordTypedChar(el: Element, ch: string): void {
      const k = elementKey(el);
      typedBuffers.set(k, (typedBuffers.get(k) ?? '') + ch);
      scheduleLiveFill(el, k);
    }

    /**
     * A field being typed into emits one step that keeps being replaced, so the
     * panel shows the value growing. Debounced, because otherwise every keystroke
     * would be a message and a storage write.
     */
    function scheduleLiveFill(el: Element, k: string): void {
      const existing = liveTimers.get(k);
      if (existing) clearTimeout(existing);
      liveTimers.set(
        k,
        window.setTimeout(() => {
          liveTimers.delete(k);
          if (!recording || !el.isConnected) return;
          const value = (el as HTMLInputElement).value ?? '';
          const isPassword = el instanceof HTMLInputElement && el.type.toLowerCase() === 'password';
          if (isPassword) {
            // Never send a partial password. The provisional step just marks the
            // field as being filled; `change` resolves it properly.
            emit(build('fill', el, { sensitive: true, upsertKey: k }));
            return;
          }
          emit(build('fill', el, { ...valueOrVariable(value), upsertKey: k }));
        }, 200),
      );
    }

    /**
     * True when the field's value is not what was typed — an input mask rewrote
     * it. Assigning the masked result back with `fill()` would bypass the mask,
     * so the raw keystrokes have to be replayed instead.
     */
    function maskedTyping(el: Element, finalValue: string): string | undefined {
      const typed = typedBuffers.get(elementKey(el));
      if (!typed || typed.length === 0) return undefined;
      return typed !== finalValue ? typed : undefined;
    }

    /**
     * A value that matches known test data is stored as a reference, not a
     * literal — so one fixed phone number never ends up baked into fifty
     * generated scripts.
     */
    function valueOrVariable(value: string): Partial<RecordedStep> {
      const hit = matchVariable(value, variables);
      return hit ? { variable: hit.name } : { value };
    }

    /** The settled fill step for a field, once focus has left it. */
    function finalFill(el: Element, value: string): Omit<RecordedStep, 'seq'> {
      const k = elementKey(el);
      const pending = liveTimers.get(k);
      if (pending) {
        clearTimeout(pending);
        liveTimers.delete(k);
      }

      const raw = maskedTyping(el, value);
      typedBuffers.delete(k);

      return raw
        ? build('fill', el, { value: raw, typeSequentially: true, upsertKey: k })
        : build('fill', el, { ...valueOrVariable(value), upsertKey: k });
    }

    function flushPendingClick(): void {
      if (!pendingClick) return;
      clearTimeout(pendingClick.timer);
      emit(pendingClick.step);
      pendingClick = null;
    }

    function onClick(event: MouseEvent): void {
      if (!recording || !event.isTrusted) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const el = resolveInteractive(target);
      const step = build('click', el);

      // Hold the click: if a dblclick follows, one double-click step is the
      // truthful record of what the user did, not two clicks plus a dblclick.
      flushPendingClick();
      pendingClick = {
        step,
        timer: window.setTimeout(flushPendingClick, DBLCLICK_WINDOW_MS),
      };
    }

    function onDblClick(event: MouseEvent): void {
      if (!recording || !event.isTrusted) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (pendingClick) {
        clearTimeout(pendingClick.timer);
        pendingClick = null;
      }
      emit(build('dblclick', resolveInteractive(target)));
    }

    function onChange(event: Event): void {
      if (!recording || !event.isTrusted) return;
      const el = event.target;
      if (!(el instanceof Element)) return;

      // A change on another element means the user left the field they were in.
      flushPendingClick();

      if (el instanceof HTMLSelectElement) {
        emit(build('select', el, valueOrVariable(el.value)));
        return;
      }

      if (el instanceof HTMLInputElement) {
        const type = el.type.toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
          emit(build(el.checked ? 'check' : 'uncheck', el));
          return;
        }
        if (type === 'file') {
          // The file itself cannot be replayed from a recording; the script needs
          // a fixture path the author supplies.
          emit(build('fill', el, { value: '', note: 'File upload — supply a fixture path' }));
          return;
        }
        if (type === 'password') {
          // The only place the recorder reads a password field. The text is
          // compared against known secrets in memory and then dropped — what
          // gets stored is a variable name or nothing at all.
          const secret = matchVariable(el.value, variables);
          emit(
            secret
              ? build('fill', el, { variable: secret.name })
              : build('fill', el, { sensitive: true }),
          );
          return;
        }
        emit(finalFill(el, el.value));
        return;
      }

      if (el instanceof HTMLTextAreaElement) {
        emit(finalFill(el, el.value));
      }
    }

    /**
     * Keys that mean something wherever they are pressed. Tab stays in the list
     * even inside a field, because tabbing out *is* the action that moves on, and
     * the arrows stay because that is how an autocomplete list is navigated.
     */
    const ALWAYS_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown']);

    /**
     * Keys that only carry meaning outside a text field. Inside one they move the
     * caret or edit characters, and the resulting text is already captured by the
     * fill step — recording them would describe the same edit twice.
     */
    const OUTSIDE_TEXT_KEYS = new Set([
      'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
      'Backspace', 'Delete',
    ]);

    function isTextEntry(el: Element): boolean {
      if (el instanceof HTMLTextAreaElement) return true;
      if (el.hasAttribute('contenteditable')) return true;
      if (el instanceof HTMLInputElement) {
        return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range'].includes(
          el.type.toLowerCase(),
        );
      }
      return false;
    }

    /** Playwright's key syntax, which Cypress and Selenium are mapped from. */
    function keyName(event: KeyboardEvent): string | undefined {
      const modifiers: string[] = [];
      if (event.ctrlKey) modifiers.push('Control');
      if (event.metaKey) modifiers.push('Meta');
      if (event.altKey) modifiers.push('Alt');
      // Shift is only a modifier worth naming alongside another modifier or a
      // non-printable key; "Shift+a" is just "A".
      if (event.shiftKey && (modifiers.length > 0 || event.key.length > 1)) {
        modifiers.push('Shift');
      }

      const base = event.key === ' ' ? 'Space' : event.key;

      if (modifiers.length > 0) {
        // A bare modifier press on its own is not an action.
        if (['Control', 'Meta', 'Alt', 'Shift'].includes(base)) return undefined;
        return [...modifiers, base.length === 1 ? base.toUpperCase() : base].join('+');
      }

      const target = event.target;
      const inText = target instanceof Element && isTextEntry(target);
      if (ALWAYS_KEYS.has(base)) return base;
      if (!inText && OUTSIDE_TEXT_KEYS.has(base)) return base;
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (!recording || !event.isTrusted) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      // Printable characters feed the mask detector rather than becoming steps.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTextEntry(target)) recordTypedChar(target, event.key);
        return;
      }
      if (event.key === 'Backspace' && isTextEntry(target)) {
        typedBuffers.set(elementKey(target), (typedBuffers.get(elementKey(target)) ?? '').slice(0, -1));
      }

      const key = keyName(event);
      if (!key) return;

      flushPendingClick();
      emit(build('press', target, { key }));
    }

    /* ---- scrolling ------------------------------------------------------ */

    /** A scroll burst is one intent, not the fifty events the browser fires. */
    const SCROLL_SETTLE_MS = 400;
    /** Below this the scroll was incidental, not something a test needs to do. */
    const SCROLL_MIN_DELTA = 60;
    /**
     * Clicks and navigations scroll the page themselves, and every framework
     * scrolls an element into view before acting on it. Recording those would add
     * a step that the generated script would perform twice.
     */
    const SCROLL_IGNORE_AFTER_ACTION_MS = 700;

    let scrollTimer = 0;
    let scrollAnchorY: number | null = null;
    let lastActionAt = 0;

    /** Within this of the bottom counts as "at the bottom". */
    const BOTTOM_SLACK_PX = 150;
    /** Content loading is asynchronous, so the growth check has to wait for it. */
    const LOAD_WAIT_MS = 900;
    /** Below this the document did not really grow. */
    const GROWTH_MIN_PX = 120;

    /**
     * Consecutive load-more scrolls collapse into one step whose repeat count
     * grows, rather than one step per round. Any other action ends the run.
     */
    let bottomRuns = 0;

    const documentHeight = () =>
      Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      );

    const atBottom = () =>
      window.scrollY + window.innerHeight >= documentHeight() - BOTTOM_SLACK_PX;

    /**
     * The element a reader would say the page scrolled *to*: the one nearest the
     * middle of the viewport that a locator can actually name.
     */
    function elementAtViewportCentre(): Element | undefined {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      // Probe a short vertical band, since the exact centre may be empty space.
      for (const dy of [0, -60, 60, -120, 120]) {
        const hit = document.elementFromPoint(cx, cy + dy);
        if (!hit || hit === document.body || hit === document.documentElement) continue;
        const named = hit.closest(
          'button, a[href], input, select, textarea, [role="button"], [data-testid], h1, h2, h3, li, article, section',
        );
        const candidate = named ?? hit;
        if (candidate.getAttribute('data-qa-plugin-ui')) continue;
        if (shortName(candidate) || candidate.getAttribute('data-testid')) return candidate;
      }
      return undefined;
    }

    function onScroll(): void {
      if (!recording) return;
      if (Date.now() - lastActionAt < SCROLL_IGNORE_AFTER_ACTION_MS) return;

      if (scrollAnchorY === null) scrollAnchorY = window.scrollY;
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        const from = scrollAnchorY ?? window.scrollY;
        scrollAnchorY = null;
        if (Math.abs(window.scrollY - from) < SCROLL_MIN_DELTA) return;

        // At the bottom of the page this may be an infinite list rather than a
        // scroll to something. The two are told apart by whether the document
        // then grows, which only becomes visible after the fetch resolves.
        if (atBottom()) {
          const heightBefore = documentHeight();
          window.setTimeout(() => {
            if (!recording) return;
            if (documentHeight() - heightBefore >= GROWTH_MIN_PX) {
              bottomRuns += 1;
              flushPendingClick();
              // Same upsert key each round, so the store replaces the previous
              // step and the count accumulates in place.
              emit({
                id: uid('step'),
                action: 'scrollToBottom',
                repeat: bottomRuns,
                upsertKey: 'scroll-to-bottom',
                url: location.href,
                timestamp: Date.now(),
              });
              return;
            }
            // The page did not grow: an ordinary scroll that happened to end low.
            const late = elementAtViewportCentre();
            if (late) {
              flushPendingClick();
              emit(build('scrollTo', late));
            }
          }, LOAD_WAIT_MS);
          return;
        }

        const anchor = elementAtViewportCentre();
        // With nothing nameable in view there is no robust step to generate, and
        // a raw offset would be worse than no step at all.
        if (!anchor) return;

        flushPendingClick();
        emit(build('scrollTo', anchor));
      }, SCROLL_SETTLE_MS);
    }

    /** The element the user last right-clicked; the menu event does not carry it. */
    let lastContextTarget: Element | null = null;

    function onContextMenu(event: MouseEvent): void {
      const target = event.target;
      if (target instanceof Element) lastContextTarget = target;
    }

    /**
     * Substring matching makes a long phrase *more* brittle, not less: any copy
     * edit anywhere inside it breaks the assertion.
     */
    const PRESENT_TEXT_LIMIT = 120;

    function readableText(el: Element): string {
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      // A whole-container text assertion is never what the tester meant, so keep
      // it to something a person could have read off the screen.
      return text.slice(0, EXACT_TEXT_LIMIT * 4);
    }

    function captureAssertion(kind: AssertAction): void {
      if (!recording) {
        toast('Start recording before adding an assertion');
        return;
      }

      if (kind === 'assertTextPresent') {
        // A selection is the more precise intent: the tester highlighted exactly
        // the phrase they mean. Without one, fall back to the element's text.
        const selected = (window.getSelection()?.toString() ?? '').replace(/\s+/g, ' ').trim();
        const source = selected || (lastContextTarget ? readableText(lastContextTarget) : '');
        const text = source.slice(0, PRESENT_TEXT_LIMIT).trim();

        if (!text) {
          toast('No text there — select the phrase, then right-click it');
          return;
        }

        emit({
          id: uid('step'),
          action: 'assertTextPresent',
          value: text,
          // The element is kept for the panel to show where the text came from;
          // the generated locator targets the text, not this element.
          target: lastContextTarget?.isConnected
            ? describeElement(lastContextTarget)
            : undefined,
          url: location.href,
          timestamp: Date.now(),
        });
        toast(`Will assert "${text.slice(0, 40)}" appears`);
        return;
      }

      if (kind === 'assertUrl') {
        if (!isTopFrame) {
          toast('URL assertions only work on the main page, not inside an iframe');
          return;
        }
        emit({
          id: uid('step'),
          action: 'assertUrl',
          value: location.href,
          url: location.href,
          timestamp: Date.now(),
        });
        toast('URL assertion added');
        return;
      }

      const raw = lastContextTarget;
      // A menu click arrives well after the right-click, and a re-rendering page
      // may have replaced the node by then. Describing a detached element yields
      // a locator that matches nothing.
      if (!raw || !raw.isConnected) {
        lastContextTarget = null;
        toast('That element is gone — right-click it again');
        return;
      }

      // For a text or visibility check the interactive ancestor is usually wrong:
      // the tester pointed at the text, not at the button wrapping it.
      const el =
        kind === 'assertValue' || kind === 'assertVisible' || kind === 'assertHidden'
          ? resolveInteractive(raw)
          : raw;

      const value =
        kind === 'assertText'
          ? readableText(el)
          : kind === 'assertValue'
            ? ((el as HTMLInputElement).value ?? '')
            : undefined;

      emit({
        id: uid('step'),
        action: kind,
        target: describeElement(el),
        value,
        url: location.href,
        timestamp: Date.now(),
      });
      toast('Assertion added');
    }

    function onProbeMessage(event: MessageEvent): void {
      if (event.source !== window || !isProbeReport(event.data)) return;
      const report = event.data;
      void sendMessage({
        type: 'issue',
        issue: {
          id: uid('issue'),
          kind: report.kind,
          severity: report.severity,
          message: report.message,
          detail: report.detail,
          stack: report.stack,
          url: location.href,
          timestamp: Date.now(),
        },
      });
    }

    // Capture phase, so a page that calls stopPropagation on its own handlers
    // cannot hide the interaction from the recorder.
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    // Capture phase, so a scrolling container is seen as well as the document.
    document.addEventListener('scroll', onScroll, true);

    // Bugs are collected whether or not we are recording, so a tester who
    // notices something wrong can look back at what already happened.
    window.addEventListener('message', onProbeMessage);

    serveFramePathQueries();
    void framePath();

    chrome.runtime.onMessage.addListener((message: Message, _sender, respond) => {
      if (message.type === 'setRecording') {
        recording = message.recording;
        setBadgeVisible(recording);
      }
      if (message.type === 'setVariables') {
        variables = message.variables;
      }
      if (message.type === 'captureAssertion') {
        captureAssertion(message.kind);
      }
      if (message.type === 'ping') {
        // Answers the background's liveness check before it starts recording.
        respond({ alive: true });
      }
      return false;
    });

    // The content script is re-created on every navigation and starts idle, so
    // it has to ask whether a recording is still in progress. The tab id is
    // filled in by the background from the sender.
    void chrome.runtime
      .sendMessage({ type: 'getSession', tabId: -1 } satisfies Message)
      .then((session: { recording?: boolean } | undefined) => {
        if (session?.recording) {
          recording = true;
          setBadgeVisible(true);
        }
      })
      .catch(() => undefined);

    /* ---- on-page recording indicator ---------------------------------- */

    const OVERLAY_BASE: Partial<CSSStyleDeclaration> = {
      position: 'fixed',
      zIndex: '2147483647',
      padding: '6px 10px',
      borderRadius: '9999px',
      color: '#fff',
      // These overlays live in the page's own DOM, so the font bundled with the
      // extension is not reachable here — only a locally installed IRANSans is.
      // Exposing the bundled woff2 via web_accessible_resources would fix that
      // but would also make the extension detectable by any page, which is not
      // worth it for two lines of text.
      fontFamily: "'IRANSans', 'IRANSansX', 'Vazirmatn', system-ui, sans-serif",
      fontSize: '12px',
      fontWeight: '500',
      lineHeight: '1',
      pointerEvents: 'none',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      direction: 'ltr',
    };

    let toastTimer = 0;
    let toastEl: HTMLElement | null = null;

    /**
     * Feedback for an action that has no visible effect on the page. Adding an
     * assertion otherwise looks like nothing happened at all.
     */
    function toast(text: string): void {
      if (!isTopFrame) return;
      toastEl?.remove();
      clearTimeout(toastTimer);

      toastEl = document.createElement('div');
      toastEl.textContent = text;
      toastEl.setAttribute('data-qa-plugin-ui', 'true');
      Object.assign(toastEl.style, OVERLAY_BASE, {
        top: '48px',
        right: '12px',
        background: 'rgba(15, 23, 42, 0.95)',
      });
      document.documentElement.appendChild(toastEl);

      toastTimer = window.setTimeout(() => {
        toastEl?.remove();
        toastEl = null;
      }, 2200);
    }

    let badge: HTMLElement | null = null;

    function setBadgeVisible(visible: boolean): void {
      if (!isTopFrame) return;
      if (!visible) {
        badge?.remove();
        badge = null;
        return;
      }
      if (badge) return;

      badge = document.createElement('div');
      badge.textContent = '● QA recording';
      badge.setAttribute('data-qa-plugin-ui', 'true');
      Object.assign(badge.style, OVERLAY_BASE, {
        top: '12px',
        right: '12px',
        background: 'rgba(220, 38, 38, 0.95)',
      });
      document.documentElement.appendChild(badge);
    }
  },
});

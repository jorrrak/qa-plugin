import { defineContentScript } from 'wxt/utils/define-content-script';
import { uid } from '@/lib/id';
import { framePath, serveFramePathQueries } from '@/lib/frame-path';
import { sendMessage, type Message } from '@/lib/messaging';
import { describeElement, resolveInteractive } from '@/lib/selector-engine';
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

    /**
     * A value that matches known test data is stored as a reference, not a
     * literal — so one fixed phone number never ends up baked into fifty
     * generated scripts.
     */
    function valueOrVariable(value: string): Partial<RecordedStep> {
      const hit = matchVariable(value, variables);
      return hit ? { variable: hit.name } : { value };
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
        emit(build('fill', el, valueOrVariable(el.value)));
        return;
      }

      if (el instanceof HTMLTextAreaElement) {
        emit(build('fill', el, valueOrVariable(el.value)));
      }
    }

    /** Only keys that carry meaning in a test. Everything else is noise. */
    const RECORDED_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown']);

    function onKeyDown(event: KeyboardEvent): void {
      if (!recording || !event.isTrusted) return;
      if (!RECORDED_KEYS.has(event.key)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      flushPendingClick();
      emit(build('press', target, { key: event.key }));
    }

    /** The element the user last right-clicked; the menu event does not carry it. */
    let lastContextTarget: Element | null = null;

    function onContextMenu(event: MouseEvent): void {
      const target = event.target;
      if (target instanceof Element) lastContextTarget = target;
    }

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

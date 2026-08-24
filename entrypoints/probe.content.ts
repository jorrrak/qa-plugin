import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * The bug detector. This runs in the page's MAIN world, which is the only place
 * it can see the page's own console calls, its unhandled rejections and its
 * fetch/XHR failures — a normal content script lives in an isolated world and
 * observes none of them.
 *
 * The cost of the MAIN world is no access to chrome.*, so findings leave via
 * window.postMessage and the isolated recorder script forwards them.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  // Errors thrown inside an embedded widget are still bugs in the flow under
  // test, and the panel attributes them to the step that preceded them.
  allFrames: true,

  main() {
    type Kind =
      | 'console-error'
      | 'console-warning'
      | 'uncaught-error'
      | 'unhandled-rejection'
      | 'network-failure'
      | 'http-error'
      | 'resource-error';

    /**
     * A page in a broken render loop can emit thousands of errors a second.
     * Without a cap the extension becomes the performance problem it is meant to
     * be diagnosing.
     */
    const MAX_REPORTS_PER_WINDOW = 40;
    const WINDOW_MS = 5000;
    let windowStart = Date.now();
    let reportsInWindow = 0;
    let reporting = false;

    function report(
      kind: Kind,
      severity: 'error' | 'warning',
      message: string,
      detail?: string,
      stack?: string,
    ): void {
      // Our own postMessage must never re-enter a patched console.
      if (reporting) return;

      const now = Date.now();
      if (now - windowStart > WINDOW_MS) {
        windowStart = now;
        reportsInWindow = 0;
      }
      if (reportsInWindow >= MAX_REPORTS_PER_WINDOW) return;
      reportsInWindow += 1;

      reporting = true;
      try {
        window.postMessage(
          {
            source: 'qa-plugin-probe',
            kind,
            severity,
            message: message.slice(0, 500),
            detail: detail?.slice(0, 1000),
            stack: stack?.slice(0, 2000),
          },
          location.origin === 'null' ? '*' : location.origin,
        );
      } finally {
        reporting = false;
      }
    }

    function stringify(value: unknown): string {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    }

    /* ---- console ------------------------------------------------------- */

    for (const [method, kind, severity] of [
      ['error', 'console-error', 'error'],
      ['warn', 'console-warning', 'warning'],
    ] as const) {
      const original = console[method].bind(console);
      console[method] = (...args: unknown[]) => {
        const first = args[0];
        report(
          kind,
          severity,
          args.map(stringify).join(' '),
          undefined,
          first instanceof Error ? first.stack : undefined,
        );
        original(...args);
      };
    }

    /* ---- uncaught errors and rejections -------------------------------- */

    window.addEventListener(
      'error',
      (event) => {
        const target = event.target;
        // An error event on an element is a failed asset, not a script error.
        if (target instanceof HTMLElement && target !== (window as unknown as HTMLElement)) {
          const src =
            target.getAttribute('src') ?? target.getAttribute('href') ?? '(unknown)';
          report(
            'resource-error',
            'error',
            `Failed to load <${target.localName}>: ${src}`,
          );
          return;
        }
        report(
          'uncaught-error',
          'error',
          event.message || 'Uncaught error',
          `${event.filename}:${event.lineno}:${event.colno}`,
          event.error instanceof Error ? event.error.stack : undefined,
        );
      },
      true, // capture, so asset errors (which do not bubble) are seen
    );

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      report(
        'unhandled-rejection',
        'error',
        stringify(reason),
        undefined,
        reason instanceof Error ? reason.stack : undefined,
      );
    });

    /* ---- fetch --------------------------------------------------------- */

    const originalFetch = window.fetch;
    window.fetch = async function patchedFetch(
      this: unknown,
      ...args: Parameters<typeof fetch>
    ) {
      const [input] = args;
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : String(input);

      try {
        const response = await originalFetch.apply(this as never, args);
        if (!response.ok) {
          report(
            'http-error',
            response.status >= 500 ? 'error' : 'warning',
            `${response.status} ${response.statusText} — ${url}`,
          );
        }
        return response;
      } catch (error) {
        report('network-failure', 'error', `fetch failed — ${url}`, stringify(error));
        throw error;
      }
    };

    /* ---- XMLHttpRequest ------------------------------------------------ */

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      const href = typeof url === 'string' ? url : url.href;

      this.addEventListener('load', () => {
        if (this.status >= 400) {
          report(
            'http-error',
            this.status >= 500 ? 'error' : 'warning',
            `${this.status} ${this.statusText} — ${method} ${href}`,
          );
        }
      });
      this.addEventListener('error', () => {
        report('network-failure', 'error', `XHR failed — ${method} ${href}`);
      });

      return (originalOpen as (...a: unknown[]) => void).apply(this, [
        method,
        url,
        ...rest,
      ]);
    } as typeof XMLHttpRequest.prototype.open;
  },
});

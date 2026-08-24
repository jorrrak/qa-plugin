import { useState } from 'react';
import { TestDataSection } from './TestDataSection';
import { Badge, Button, CopyableCode } from './ui';

interface ScanResult {
  total: number;
  withTestId: number;
  withStableId: number;
  unnamed: number;
  worst: { tag: string; xpath: string }[];
}

/**
 * Runs in the page. Must be fully self-contained: `chrome.scripting` serialises
 * the function, so it cannot close over anything from this module.
 */
function scanPage(): ScanResult {
  const TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];
  const GENERATED = /^:r|^«|[0-9a-f]{8,}|\d{5,}|^\d|^(mui-|radix-|headlessui-|ember)/i;

  function hop(el: Element): string {
    const parent = el.parentElement;
    if (!parent) return el.localName;
    const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
    return same.length === 1 ? el.localName : `${el.localName}[${same.indexOf(el) + 1}]`;
  }

  function absoluteXPath(el: Element): string {
    const parts: string[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) parts.unshift(hop(n));
    return `/${parts.join('/')}`;
  }

  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="tab"]',
    ),
  ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

  const result: ScanResult = {
    total: elements.length,
    withTestId: 0,
    withStableId: 0,
    unnamed: 0,
    worst: [],
  };

  for (const el of elements) {
    const hasTestId = TEST_ID_ATTRS.some((attr) => el.getAttribute(attr)?.trim());
    const id = el.getAttribute('id');
    const hasStableId = !!id && !GENERATED.test(id);

    const name = (
      el.getAttribute('aria-label') ??
      el.innerText ??
      el.getAttribute('placeholder') ??
      el.getAttribute('title') ??
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();

    if (hasTestId) result.withTestId += 1;
    if (hasStableId) result.withStableId += 1;

    if (!hasTestId && !hasStableId && !name) {
      result.unnamed += 1;
      if (result.worst.length < 10) {
        result.worst.push({ tag: el.localName, xpath: absoluteXPath(el) });
      }
    }
  }

  return result;
}

function pageInfo() {
  return {
    url: location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
    language: navigator.language,
  };
}

function clearSiteStorage(): string {
  const local = localStorage.length;
  const session = sessionStorage.length;
  localStorage.clear();
  sessionStorage.clear();
  return `Cleared ${local} localStorage and ${session} sessionStorage keys`;
}

export function ToolsTab({ tabId }: { tabId: number | null }) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [env, setEnv] = useState<ReturnType<typeof pageInfo> | null>(null);
  const [busy, setBusy] = useState(false);

  async function run<T>(func: () => T): Promise<T | undefined> {
    if (tabId == null) return undefined;
    setBusy(true);
    try {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func });
      return injection?.result as T | undefined;
    } catch (error) {
      setStatus(`Injection failed: ${String(error)}`);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-3">
      <TestDataSection />

      <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h3 className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
          Locator health
        </h3>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          Counts how many interactive elements carry a <code>data-testid</code> or a stable
          id. The higher that number, the less flaky the generated tests.
        </p>
        <Button
          variant="primary"
          disabled={busy || tabId == null}
          onClick={async () => {
            const result = await run(scanPage);
            if (result) setScan(result);
          }}
        >
          Scan active page
        </Button>

        {scan && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge>total: {scan.total}</Badge>
              <Badge tone={scan.withTestId > 0 ? 'emerald' : 'red'}>
                with test-id: {scan.withTestId}
              </Badge>
              <Badge tone="sky">with stable id: {scan.withStableId}</Badge>
              <Badge tone={scan.unnamed > 0 ? 'amber' : 'emerald'}>
                no identifier at all: {scan.unnamed}
              </Badge>
            </div>
            {scan.worst.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-slate-500">
                  Only reachable by a structural path:
                </p>
                {scan.worst.map((item) => (
                  <CopyableCode
                    key={item.xpath}
                    value={item.xpath}
                    label={`<${item.tag}> ${item.xpath}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          Environment
        </h3>
        <Button
          disabled={busy || tabId == null}
          onClick={async () => {
            const info = await run(pageInfo);
            if (info) setEnv(info);
          }}
        >
          Read
        </Button>
        {env && (
          <div className="mt-2 space-y-1">
            {Object.entries(env).map(([key, value]) => (
              <div key={key} className="text-[11px]">
                <span className="text-slate-400">{key}: </span>
                <CopyableCode value={String(value)} />
              </div>
            ))}
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(
                  Object.entries(env)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n'),
                );
              }}
            >
              Copy all (for a bug report)
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h3 className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
          Reset site state
        </h3>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          Clears localStorage and sessionStorage for this origin. Cookies are left alone.
        </p>
        <Button
          variant="danger"
          disabled={busy || tabId == null}
          onClick={async () => {
            const message = await run(clearSiteStorage);
            if (message) setStatus(message);
          }}
        >
          Clear storage
        </Button>
      </section>

      {status && <p className="text-[11px] text-slate-500">{status}</p>}
    </div>
  );
}

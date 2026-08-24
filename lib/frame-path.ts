import { cssSelector } from './selector-engine/css';
import { robustXPath } from './selector-engine/xpath';
import type { FrameRef } from './types';

/**
 * Works out where the current frame sits in the iframe tree, as a chain of
 * locators for the `<iframe>` elements leading to it.
 *
 * A frame cannot look at its own parent's DOM when the two are cross-origin, so
 * it asks instead: it posts "which iframe am I?" upwards, and the parent — which
 * does have a content script and does own that element — answers with its own
 * path plus a locator for the child. The recursion terminates at the top frame,
 * whose path is empty. postMessage is the only channel that crosses an origin
 * boundary, which is why this is not a simple DOM walk.
 */

const CHANNEL = 'qa-plugin-frame';
/** Long enough for a parent that is still parsing; short enough to not stall. */
const REPLY_TIMEOUT_MS = 2000;

interface WhoAmI {
  channel: typeof CHANNEL;
  kind: 'whoami';
  nonce: string;
}

interface YouAre {
  channel: typeof CHANNEL;
  kind: 'youare';
  nonce: string;
  path: FrameRef[];
}

const UNRESOLVED: FrameRef = {
  selector: '',
  xpath: '',
  unresolved: true,
};

function isWhoAmI(data: unknown): data is WhoAmI {
  const d = data as WhoAmI | null;
  return d?.channel === CHANNEL && d.kind === 'whoami' && typeof d.nonce === 'string';
}

function isYouAre(data: unknown): data is YouAre {
  const d = data as YouAre | null;
  return d?.channel === CHANNEL && d.kind === 'youare' && Array.isArray(d.path);
}

let cached: Promise<FrameRef[]> | null = null;

/** Cached: the answer cannot change for the lifetime of this document. */
export function framePath(): Promise<FrameRef[]> {
  cached ??= askParent();
  return cached;
}

function askParent(): Promise<FrameRef[]> {
  if (window.top === window) return Promise.resolve([]);

  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      finish([UNRESOLVED]);
    }, REPLY_TIMEOUT_MS);

    function finish(path: FrameRef[]): void {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(path);
    }

    function onMessage(event: MessageEvent): void {
      // Only the parent may answer. Without this check any frame on the page
      // could forge a path and send the generated test at the wrong element.
      if (event.source !== window.parent) return;
      if (!isYouAre(event.data) || event.data.nonce !== nonce) return;
      finish(event.data.path);
    }

    window.addEventListener('message', onMessage);
    // The parent's origin is unknown here, so '*' is unavoidable. The payload is
    // a nonce and nothing else, so there is nothing to leak.
    window.parent.postMessage({ channel: CHANNEL, kind: 'whoami', nonce } satisfies WhoAmI, '*');
  });
}

function findChildFrame(source: MessageEventSource): Element | undefined {
  const frames = document.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>(
    'iframe, frame',
  );
  for (const frame of frames) {
    if (frame.contentWindow === source) return frame;
  }
  return undefined;
}

/** Answers "which iframe am I?" for direct children. Install in every frame. */
export function serveFramePathQueries(): void {
  window.addEventListener('message', (event) => {
    if (!isWhoAmI(event.data)) return;

    const source = event.source;
    if (!source) return;

    const element = findChildFrame(source);
    // A message claiming to be from a child that owns none of our iframes is
    // either a forgery or a frame that has already been removed.
    if (!element) return;

    const nonce = event.data.nonce;

    void framePath().then((ownPath) => {
      const ref: FrameRef = {
        selector: cssSelector(element),
        xpath: robustXPath(element),
        name: element.getAttribute('name') ?? undefined,
        src: element.getAttribute('src') ?? undefined,
      };
      const reply: YouAre = {
        channel: CHANNEL,
        kind: 'youare',
        nonce,
        path: [...ownPath, ref],
      };
      source.postMessage(reply, {
        targetOrigin: event.origin === 'null' ? '*' : event.origin,
      });
    });
  });
}

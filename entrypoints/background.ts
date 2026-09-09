import { defineBackground } from 'wxt/utils/define-background';
import { onMessage, sendToTab, type Message } from '@/lib/messaging';
import { uid } from '@/lib/id';
import {
  appendIssue,
  appendStep,
  clearSession,
  deleteStep,
  dropSession,
  insertStep,
  moveStep,
  mutateSession,
  readSession,
  renameSession,
  setRecording,
  updateStep,
} from '@/lib/session-store';
import type { AssertAction, Session } from '@/lib/types';
import { isRecordableUrl, sameLocation } from '@/lib/url';
import { listVariables } from '@/lib/variables';

/** Right-click entries the tester uses to add a check mid-recording. */
const ASSERT_MENU: { id: AssertAction; title: string }[] = [
  { id: 'assertTextPresent', title: 'Assert this text appears on the page' },
  { id: 'assertText', title: 'Assert this element\'s text' },
  { id: 'assertValue', title: "Assert this field's value" },
  { id: 'assertVisible', title: 'Assert this element is visible' },
  { id: 'assertHidden', title: 'Assert this element is hidden' },
  { id: 'assertUrl', title: 'Assert the page URL' },
];

function createMenus(): void {
  // removeAll first, otherwise a reload of the extension throws on duplicate ids.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'qa-assert-root',
      title: 'QA — add assertion',
      contexts: ['all'],
    });
    for (const entry of ASSERT_MENU) {
      chrome.contextMenus.create({
        id: entry.id,
        parentId: 'qa-assert-root',
        title: entry.title,
        contexts: ['all'],
      });
    }
  });
}

/** Let the panel repaint without polling. Fails silently when no panel is open. */
function broadcast(session: Session): void {
  const message: Message = { type: 'sessionChanged', session };
  chrome.runtime.sendMessage(message).catch(() => {
    /* no panel listening */
  });
}

async function handle(message: Message, sender: chrome.runtime.MessageSender) {
  // A message from a content script carries its own tab; a message from the
  // panel has to name the tab it is acting on, because the panel has no tab.
  const senderTabId = sender.tab?.id;

  switch (message.type) {
    case 'step': {
      if (senderTabId == null) return undefined;
      return broadcastAndReturn(await appendStep(senderTabId, message.step));
    }
    case 'issue': {
      if (senderTabId == null) return undefined;
      return broadcastAndReturn(await appendIssue(senderTabId, message.issue));
    }
    case 'getSession':
      // A content script asking for its own session does not know its tab id;
      // the sender does. The panel has no tab, so it names one explicitly.
      return readSession(senderTabId ?? message.tabId);
    case 'startRecording': {
      // A tab that was already open when the extension was installed has no
      // content script in it. Without this the record button silently does
      // nothing, which is the worst possible first-run experience.
      await ensureInjected(message.tabId);
      let session = await setRecording(message.tabId, true);
      session = await recordOpeningUrl(message.tabId, session);
      // Variables first: a value typed in the first second of recording should
      // already be substituted.
      sendToTab(message.tabId, { type: 'setVariables', variables: await listVariables() });
      sendToTab(message.tabId, { type: 'setRecording', recording: true });
      return broadcastAndReturn(session);
    }
    case 'stopRecording': {
      const session = await setRecording(message.tabId, false);
      sendToTab(message.tabId, { type: 'setRecording', recording: false });
      return broadcastAndReturn(session);
    }
    case 'clearSession':
      return broadcastAndReturn(await clearSession(message.tabId));
    case 'renameSession':
      return broadcastAndReturn(await renameSession(message.tabId, message.title));
    case 'deleteStep':
      return broadcastAndReturn(await deleteStep(message.tabId, message.stepId));
    case 'updateStep':
      return broadcastAndReturn(
        await updateStep(message.tabId, message.stepId, message.patch),
      );
    case 'moveStep':
      return broadcastAndReturn(
        await moveStep(message.tabId, message.stepId, message.direction),
      );
    case 'insertStep':
      return broadcastAndReturn(
        await insertStep(message.tabId, message.afterStepId, message.step),
      );
    default:
      return undefined;
  }
}

/** Built content-script paths, as emitted into the extension bundle. */
const CONTENT_SCRIPTS = {
  probe: 'content-scripts/probe.js',
  recorder: 'content-scripts/recorder.js',
} as const;

async function ensureInjected(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' } satisfies Message);
    return; // already there
  } catch {
    // No receiver — fall through and inject.
  }

  try {
    // The probe needs the page's own realm to see its console and its fetch.
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPTS.probe],
      world: 'MAIN',
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPTS.recorder],
    });
  } catch {
    // chrome:// pages, the Web Store and PDF viewers refuse injection. Recording
    // there is not possible at all, so there is nothing to recover.
  }
}

/**
 * Where the flow stands, as far as the recorded steps say: every step carries the
 * `location.href` it happened at, and a navigation carries its destination.
 */
function currentPageOf(session: Session): string | undefined {
  const last = session.steps[session.steps.length - 1];
  if (!last) return undefined;
  return last.action === 'navigate' ? (last.value ?? last.url) : last.url;
}

/**
 * A recording has to begin by opening the page under test.
 *
 * Navigation steps otherwise come only from a page load that happens *while*
 * recording — so the normal workflow, open the page and then press record,
 * produced a script with no `goto` at all. It would start on a blank page and
 * fail on its first click, with nothing in the output hinting at why.
 *
 * The test is not "is this a fresh session" but "is the flow already on this
 * page". Those are different in the case that matters most: a tester stops,
 * walks to another page, and presses record again — which is the whole reason
 * to stop. Keyed on freshness, the second half of the flow was generated with
 * no goto and ran against whatever page the first half had ended on.
 */
async function recordOpeningUrl(tabId: number, current: Session): Promise<Session> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  // A tab that is still loading reports an empty `url` and keeps its destination
  // in `pendingUrl`. Pressing record while the page comes up is normal, and it
  // used to produce a recording with no opening navigation at all.
  const url = isRecordableUrl(tab?.url) ? tab.url : tab?.pendingUrl;
  if (!isRecordableUrl(url)) return current;

  if (sameLocation(currentPageOf(current), url)) return current;

  return appendStep(tabId, {
    id: uid('step'),
    action: 'navigate',
    value: url,
    url,
    timestamp: Date.now(),
    // A goto in the middle of a flow reads like a mistake without this.
    note: current.steps.length > 0 ? 'Recording resumed on this page' : undefined,
  });
}

function broadcastAndReturn(session: Session): Session {
  broadcast(session);
  return session;
}

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel. Without this the action
  // click does nothing at all, which reads as a broken extension.
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      /* older Chrome without the sidePanel API */
    });

  onMessage(handle);

  createMenus();
  chrome.runtime.onInstalled.addListener(createMenus);

  // Editing test data while recording should take effect immediately, not after
  // a restart of the recording.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !('variables' in changes)) return;
    const variables = await listVariables();
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null) sendToTab(tab.id, { type: 'setVariables', variables });
    }
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id == null) return;
    const kind = info.menuItemId as AssertAction;
    if (!ASSERT_MENU.some((entry) => entry.id === kind)) return;
    // The content script knows which element was right-clicked; the menu event
    // does not carry it.
    sendToTab(tab.id, { type: 'captureAssertion', kind });
  });

  // A page load during recording is itself a step — the generated script needs
  // the goto, and a tester reading the steps needs to see the navigation.
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete' || !changeInfo.url) return;
    const session = await readSession(tabId);
    if (!session.recording) return;

    const lastStep = session.steps[session.steps.length - 1];
    if (lastStep?.action === 'navigate' && lastStep.value === changeInfo.url) return;

    broadcast(
      await appendStep(tabId, {
        id: uid('step'),
        action: 'navigate',
        value: changeInfo.url,
        url: changeInfo.url,
        timestamp: Date.now(),
      }),
    );

    // The freshly loaded content script starts idle and has to be told we are
    // still recording.
    sendToTab(tabId, { type: 'setRecording', recording: true });
  });

  // Keep the panel in sync when the user switches tabs.
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    broadcast(await readSession(tabId));
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void dropSession(tabId);
  });

  // Recording never survives a browser restart: the pages are gone, so the steps
  // would describe a flow nobody can reproduce.
  chrome.runtime.onStartup.addListener(async () => {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null) await mutateSession(tab.id, (s) => ({ ...s, recording: false }));
    }
  });
});

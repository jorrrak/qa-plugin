import type { AssertAction, Issue, RecordedStep, Session } from './types';
import type { TestVariable } from './variables';

/**
 * A single typed channel for every direction of traffic. Keeping one union means
 * adding a message is one edit here and the compiler finds every handler that
 * needs updating.
 */
export type Message =
  // content script -> background
  | { type: 'step'; step: Omit<RecordedStep, 'seq'> }
  | { type: 'issue'; issue: Omit<Issue, 'count'> }
  // panel -> background
  | { type: 'getSession'; tabId: number }
  | { type: 'startRecording'; tabId: number }
  | { type: 'stopRecording'; tabId: number }
  | { type: 'clearSession'; tabId: number }
  | { type: 'renameSession'; tabId: number; title: string }
  | { type: 'deleteStep'; tabId: number; stepId: string }
  | { type: 'annotateStep'; tabId: number; stepId: string; note: string }
  // background -> content script
  | { type: 'setRecording'; recording: boolean }
  | { type: 'setVariables'; variables: TestVariable[] }
  | { type: 'captureAssertion'; kind: AssertAction }
  | { type: 'ping' }
  // background -> panel (broadcast)
  | { type: 'sessionChanged'; session: Session };

export type MessageOf<T extends Message['type']> = Extract<Message, { type: T }>;

export function sendMessage(message: Message): Promise<Session | undefined> {
  // The panel and content scripts both talk to the background, which is the only
  // component allowed to touch storage. Errors are swallowed on purpose: sending
  // to a tab that has since navigated away is normal, not exceptional.
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

export function sendToTab(tabId: number, message: Message): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    /* no receiver in this tab yet — the content script registers on load */
  });
}

export function onMessage(
  handler: (
    message: Message,
    sender: chrome.runtime.MessageSender,
  ) => void | Promise<unknown>,
): void {
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    const result = handler(message, sender);
    if (result instanceof Promise) {
      result.then(sendResponse, () => sendResponse(undefined));
      return true; // keep the channel open for the async reply
    }
    return false;
  });
}

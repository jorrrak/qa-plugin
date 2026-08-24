import { useCallback, useEffect, useState } from 'react';
import { sendMessage, type Message } from '@/lib/messaging';
import type { Session } from '@/lib/types';

/**
 * The panel is not attached to a tab, so it tracks the active tab itself and
 * re-reads the session whenever the user switches tabs or the page reloads.
 */
export function useSession() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const load = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    setTabId(tab.id);
    const loaded = await sendMessage({ type: 'getSession', tabId: tab.id });
    if (loaded) setSession(loaded);
  }, []);

  useEffect(() => {
    void load();

    const onActivated = () => void load();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.status === 'complete') void load();
    };
    const onBroadcast = (message: Message) => {
      if (message.type !== 'sessionChanged') return;
      // The background broadcasts for whichever tab changed; ignore other tabs.
      setSession((current) =>
        current == null || current.tabId === message.session.tabId
          ? message.session
          : current,
      );
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.runtime.onMessage.addListener(onBroadcast);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onBroadcast);
    };
  }, [load]);

  /** Send a command and adopt the session the background sends back. */
  const act = useCallback(async (message: Message) => {
    const updated = await sendMessage(message);
    if (updated) setSession(updated);
  }, []);

  return { tabId, session, act, reload: load };
}

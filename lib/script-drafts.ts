/**
 * Hand edits to a generated script.
 *
 * The script is *generated* from the steps, so an edit to it is a fork, and the
 * question that decides this whole design is what happens when the steps change
 * afterwards. Silently keeping the stale text is wrong; silently throwing the
 * edit away is worse. So a draft records the version of the generated script it
 * started from, and the panel can say "the steps have changed since you edited
 * this" rather than choosing for the tester.
 *
 * Drafts live in their own storage key rather than inside `Session`, and that is
 * a security boundary, not tidiness. The library file and every export are built
 * from the session object; a hand-edited script is free text a person typed, and
 * it is the one place in this extension where a literal password can appear.
 * Keeping drafts out of the session means they stay on this machine and never
 * travel in a shared `qa-library.json`.
 */

export interface ScriptDraft {
  text: string;
  /**
   * Fingerprint of the generated script this edit started from. Comparing it
   * against the current generated script is what detects a stale draft.
   */
  baseHash: string;
  savedAt: number;
}

/**
 * One draft per format *and* locator strategy: editing the Playwright output and
 * then switching to Cypress should not show the Playwright edit.
 */
export type DraftMap = Record<string, ScriptDraft>;

/**
 * A hand-edited script that runs past this is not an edit, it is a paste of
 * something else. The cap keeps one runaway value out of extension storage.
 */
const MAX_DRAFT_CHARS = 1_000_000;

const key = (sessionId: string) => `scriptDrafts:${sessionId}`;

export function draftSlot(format: string, strategy: string, usesStrategy: boolean): string {
  // Formats with no locator strategy would otherwise get a draft per strategy,
  // three copies of the same edit, only one of them ever shown.
  return usesStrategy ? `${format}|${strategy}` : format;
}

/**
 * A 32-bit FNV-1a, as hex. Not a checksum against tampering — only against the
 * steps having moved on. A collision costs a missed staleness warning.
 */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export async function readDrafts(sessionId: string): Promise<DraftMap> {
  const stored = await chrome.storage.local.get(key(sessionId));
  return (stored[key(sessionId)] as DraftMap | undefined) ?? {};
}

export async function saveDraft(
  sessionId: string,
  slot: string,
  text: string,
  baseHash: string,
): Promise<DraftMap> {
  if (text.length > MAX_DRAFT_CHARS) return readDrafts(sessionId);
  const drafts = await readDrafts(sessionId);
  const next: DraftMap = { ...drafts, [slot]: { text, baseHash, savedAt: Date.now() } };
  await chrome.storage.local.set({ [key(sessionId)]: next });
  return next;
}

/** Reverting to the generated script removes the draft rather than storing a copy of it. */
export async function clearDraft(sessionId: string, slot: string): Promise<DraftMap> {
  const drafts = await readDrafts(sessionId);
  if (!(slot in drafts)) return drafts;
  const next = { ...drafts };
  delete next[slot];
  if (Object.keys(next).length === 0) {
    await chrome.storage.local.remove(key(sessionId));
    return {};
  }
  await chrome.storage.local.set({ [key(sessionId)]: next });
  return next;
}

/**
 * Every draft for a session. Called when the session is cleared or its tab
 * closes — a cleared session gets a fresh id, so without this the old drafts
 * would sit in storage forever with nothing able to reach them.
 */
export async function dropDrafts(sessionId: string): Promise<void> {
  await chrome.storage.local.remove(key(sessionId));
}

import { uid } from './id';
import { fingerprint } from './library-file';
import type { Session } from './types';

const KEY = 'library';

/**
 * Measured cost at this cap: ~3.3 MB for 500 short cases, ~9 MB at 30 steps each,
 * ~18 MB at 60. The last figure is past the 10 MB default quota, which is why the
 * manifest asks for `unlimitedStorage` — without it a team with substantial test
 * cases would hit a write failure somewhere north of 300 saves.
 */
export const MAX_TEST_CASES = 500;

/** Thrown instead of quietly discarding the oldest test case. */
export class LibraryFullError extends Error {
  constructor() {
    super(`Library is full (${MAX_TEST_CASES} test cases). Delete or export some first.`);
    this.name = 'LibraryFullError';
  }
}

export interface SavedTestCase {
  id: string;
  title: string;
  savedAt: number;
  /** First URL of the flow, so the list is scannable without opening each one. */
  origin: string;
  stepCount: number;
  assertionCount: number;
  issueCount: number;
  /** Full snapshot, so a saved case can be re-exported in any format later. */
  session: Session;
}

/**
 * The library is global rather than per-tab, and the panel is its only writer.
 * A single chain still guards against two windows' panels saving at once — each
 * side panel is its own instance.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

export async function listTestCases(): Promise<SavedTestCase[]> {
  const stored = await chrome.storage.local.get(KEY);
  const cases = (stored[KEY] as SavedTestCase[] | undefined) ?? [];
  return cases.slice().sort((a, b) => b.savedAt - a.savedAt);
}

async function write(cases: SavedTestCase[]): Promise<SavedTestCase[]> {
  try {
    await chrome.storage.local.set({ [KEY]: cases });
  } catch (error) {
    // Should not happen with `unlimitedStorage`, but a raw "QUOTA_BYTES quota
    // exceeded" tells a tester nothing about what to do next.
    const message = error instanceof Error ? error.message : String(error);
    if (/quota/i.test(message)) {
      throw new Error(
        'Browser storage is full. Export the library to a file, then clear some test cases.',
      );
    }
    throw error;
  }
  return cases;
}

/** Bytes the library currently occupies, for display next to the count. */
export async function libraryBytes(): Promise<number> {
  try {
    return await chrome.storage.local.getBytesInUse(KEY);
  } catch {
    return 0;
  }
}

function summarise(session: Session): Omit<SavedTestCase, 'id' | 'savedAt'> {
  const firstUrl =
    session.steps.find((step) => step.action === 'navigate')?.value ??
    session.steps[0]?.url ??
    '';

  return {
    title: session.title,
    origin: firstUrl,
    stepCount: session.steps.length,
    assertionCount: session.steps.filter((step) => step.action.startsWith('assert')).length,
    issueCount: session.issues.length,
    session,
  };
}

export function saveTestCase(session: Session): Promise<SavedTestCase[]> {
  return serialize(async () => {
    const existing = await listTestCases();
    // Truncating here would drop the *oldest* saved test case without a word.
    // For a library people rely on, refusing loudly is the only safe behaviour.
    if (existing.length >= MAX_TEST_CASES) throw new LibraryFullError();

    const entry: SavedTestCase = {
      id: uid('tc'),
      savedAt: Date.now(),
      ...summarise({ ...session, recording: false }),
    };
    return write([entry, ...existing]);
  });
}

export function deleteTestCase(id: string): Promise<SavedTestCase[]> {
  return serialize(async () => {
    const existing = await listTestCases();
    return write(existing.filter((entry) => entry.id !== id));
  });
}

export function renameTestCase(id: string, title: string): Promise<SavedTestCase[]> {
  return serialize(async () => {
    const existing = await listTestCases();
    return write(
      existing.map((entry) =>
        entry.id === id
          ? { ...entry, title, session: { ...entry.session, title } }
          : entry,
      ),
    );
  });
}

export function clearLibrary(): Promise<SavedTestCase[]> {
  return serialize(() => write([]));
}

export interface ImportReport {
  added: number;
  /** Already present with identical content — re-importing a file is a no-op. */
  skippedDuplicate: number;
  /** Same content under a different id, kept as a separate entry. */
  addedAsCopy: number;
  /** Did not fit under MAX_TEST_CASES. Reported, never dropped in silence. */
  skippedForSpace: number;
}

/**
 * Merges an imported library into the local one.
 *
 * Nothing is ever overwritten: an incoming test case either matches something
 * already here (skipped), or becomes a new entry. Overwriting would mean a
 * teammate's file could silently replace work that is not in it.
 */
export function importTestCases(incoming: SavedTestCase[]): Promise<ImportReport> {
  return serialize(async () => {
    const existing = await listTestCases();
    const seen = new Map(existing.map((entry) => [fingerprint(entry), entry]));
    const ids = new Set(existing.map((entry) => entry.id));

    const report: ImportReport = {
      added: 0,
      skippedDuplicate: 0,
      addedAsCopy: 0,
      skippedForSpace: 0,
    };
    const merged = [...existing];

    for (const entry of incoming) {
      if (merged.length >= MAX_TEST_CASES) {
        report.skippedForSpace += 1;
        continue;
      }

      const print = fingerprint(entry);
      if (seen.has(print)) {
        report.skippedDuplicate += 1;
        continue;
      }

      // Same id, different content: two edits of one case diverged. Both are
      // kept, and the incoming one gets a fresh id so neither is lost.
      const collides = ids.has(entry.id);
      const stored: SavedTestCase = collides
        ? { ...entry, id: uid('tc'), title: `${entry.title} (imported)` }
        : entry;

      merged.push(stored);
      seen.set(print, stored);
      ids.add(stored.id);
      if (collides) report.addedAsCopy += 1;
      else report.added += 1;
    }

    await write(merged);
    return report;
  });
}

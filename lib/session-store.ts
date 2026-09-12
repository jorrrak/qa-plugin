import { uid } from './id';
import { dropDrafts } from './script-drafts';
import {
  emptySession,
  MAX_STEPS,
  type Issue,
  type RecordedStep,
  type Session,
  type StepPatch,
} from './types';

const key = (tabId: number) => `session:${tabId}`;

/** Bounds so a runaway page cannot fill up extension storage. */
const MAX_ISSUES = 200;

/**
 * The service worker is torn down after ~30s idle, so nothing lives in memory
 * between events — every read goes to storage. The per-tab promise chain below
 * is what keeps two concurrent events from doing a read-modify-write on the same
 * session and silently dropping one of them.
 */
const chains = new Map<number, Promise<unknown>>();

function serialize<T>(tabId: number, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(tabId) ?? Promise.resolve();
  const next = previous.then(task, task);
  chains.set(
    tabId,
    next.catch(() => undefined),
  );
  return next;
}

export async function readSession(tabId: number): Promise<Session> {
  const stored = await chrome.storage.local.get(key(tabId));
  return (stored[key(tabId)] as Session | undefined) ?? emptySession(tabId);
}

async function write(session: Session): Promise<Session> {
  await chrome.storage.local.set({ [key(session.tabId)]: session });
  return session;
}

export function mutateSession(
  tabId: number,
  mutate: (session: Session) => Session,
): Promise<Session> {
  return serialize(tabId, async () => write(mutate(await readSession(tabId))));
}

export function setRecording(tabId: number, recording: boolean): Promise<Session> {
  return mutateSession(tabId, (session) => ({
    ...session,
    recording,
    // A fresh run starts the clock over, but keeps whatever was already captured
    // so a tester can resume after an accidental stop.
    startedAt: recording && session.steps.length === 0 ? Date.now() : session.startedAt,
  }));
}

export function appendStep(
  tabId: number,
  step: Omit<RecordedStep, 'seq'>,
): Promise<Session> {
  return mutateSession(tabId, (session) => {
    if (!session.recording) return session;

    // A step carrying an upsertKey replaces the previous one from the same source
    // instead of appending. That is what makes a field being typed into show up
    // as one growing step rather than one step per keystroke — and it must only
    // match the *last* step, so returning to a field later is a new action.
    const last = session.steps[session.steps.length - 1];
    if (last && step.upsertKey && last.upsertKey === step.upsertKey) {
      const steps = [...session.steps.slice(0, -1), { ...step, seq: last.seq }];
      return { ...session, steps };
    }

    const full: RecordedStep = { ...step, seq: session.nextSeq };
    const steps = [...session.steps, full].slice(-MAX_STEPS);
    return { ...session, steps, nextSeq: session.nextSeq + 1 };
  });
}

/** Identical issues are collapsed — one broken request in a render loop is one bug. */
function fingerprint(issue: Omit<Issue, 'count' | 'id' | 'timestamp'>): string {
  return `${issue.kind}::${issue.message}`;
}

export function appendIssue(
  tabId: number,
  incoming: Omit<Issue, 'count'>,
): Promise<Session> {
  return mutateSession(tabId, (session) => {
    const print = fingerprint(incoming);
    const existingIndex = session.issues.findIndex((i) => fingerprint(i) === print);

    if (existingIndex >= 0) {
      const issues = [...session.issues];
      const existing = issues[existingIndex]!;
      issues[existingIndex] = { ...existing, count: existing.count + 1 };
      return { ...session, issues };
    }

    // Link the issue to the action that preceded it. This is what turns a console
    // error into "clicking Save is broken".
    const lastStep = session.steps[session.steps.length - 1];
    const issue: Issue = {
      ...incoming,
      count: 1,
      nearStepId: incoming.nearStepId ?? lastStep?.id,
    };
    return { ...session, issues: [...session.issues, issue].slice(-MAX_ISSUES) };
  });
}

export function clearSession(tabId: number): Promise<Session> {
  return mutateSession(tabId, (session) => {
    // A cleared session gets a fresh id, so any hand-edited script left over
    // from the old one becomes unreachable. Drop it rather than leaving it in
    // storage for the life of the profile.
    void dropDrafts(session.id);
    return {
      ...emptySession(tabId, session.title),
      id: uid('s'),
      recording: session.recording,
    };
  });
}

export function renameSession(tabId: number, title: string): Promise<Session> {
  return mutateSession(tabId, (session) => ({ ...session, title }));
}

/**
 * A step's number is its position in the test case, so every structural edit
 * renumbers the list. Leaving gaps after a delete, or an inserted assertion
 * numbered 501 in the middle of a flow, makes a printed test case unreadable —
 * and issues are linked to steps by id, so nothing breaks by renumbering.
 */
function renumber(session: Session): Session {
  const steps = session.steps.map((step, index) => ({ ...step, seq: index + 1 }));
  return { ...session, steps, nextSeq: steps.length + 1 };
}

export function deleteStep(tabId: number, stepId: string): Promise<Session> {
  return mutateSession(tabId, (session) =>
    renumber({ ...session, steps: session.steps.filter((s) => s.id !== stepId) }),
  );
}

/**
 * Edit a step's text after the fact — the expected string in an assertion, a
 * value that was recorded from a stale fixture, a note.
 *
 * A password is not editable here, and that is a rule rather than an oversight:
 * the recorder never captured the text, so accepting one from the panel would
 * write into the session the one thing the whole design keeps out of it.
 */
export function updateStep(
  tabId: number,
  stepId: string,
  patch: StepPatch,
): Promise<Session> {
  return mutateSession(tabId, (session) => ({
    ...session,
    steps: session.steps.map((step) => {
      if (step.id !== stepId) return step;
      const next = { ...step };
      // A note becomes a comment in the generated script, so whitespace at its
      // edges is never meaningful and a blank one is no note at all. A *value*
      // is left exactly as given: a trailing space in a field can be the bug.
      if (patch.note !== undefined) next.note = patch.note.trim() || undefined;
      if (patch.key !== undefined) next.key = patch.key || undefined;
      if (patch.value !== undefined && !step.sensitive && !step.variable) {
        next.value = patch.value;
      }
      return next;
    }),
  }));
}

export function moveStep(
  tabId: number,
  stepId: string,
  direction: 'up' | 'down',
): Promise<Session> {
  return mutateSession(tabId, (session) => {
    const from = session.steps.findIndex((step) => step.id === stepId);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= session.steps.length) return session;

    const steps = [...session.steps];
    [steps[from], steps[to]] = [steps[to]!, steps[from]!];
    return renumber({ ...session, steps });
  });
}

/**
 * Put a step the tester wrote by hand into the flow — in practice an assertion
 * they only thought of after the recording had stopped.
 */
export function insertStep(
  tabId: number,
  afterStepId: string,
  step: Omit<RecordedStep, 'seq'>,
): Promise<Session> {
  return mutateSession(tabId, (session) => {
    if (session.steps.length >= MAX_STEPS) return session;

    const found = session.steps.findIndex((existing) => existing.id === afterStepId);
    // A missing anchor means the step it referred to is gone — deleted from
    // another panel, or the session was cleared. Appending is better than
    // dropping the edit on the floor.
    const index = found < 0 ? session.steps.length : found + 1;

    const steps = [...session.steps];
    // upsertKey is live-recording bookkeeping. A hand-written step carrying one
    // would silently replace whatever it landed next to.
    const { upsertKey: _ignored, ...clean } = step;
    steps.splice(index, 0, { ...clean, seq: 0 });
    return renumber({ ...session, steps });
  });
}

export async function dropSession(tabId: number): Promise<void> {
  chains.delete(tabId);
  const session = await readSession(tabId);
  await dropDrafts(session.id);
  await chrome.storage.local.remove(key(tabId));
}

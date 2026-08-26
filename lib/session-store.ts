import { uid } from './id';
import { emptySession, type Issue, type RecordedStep, type Session } from './types';

const key = (tabId: number) => `session:${tabId}`;

/** Bounds so a runaway page cannot fill up extension storage. */
const MAX_STEPS = 500;
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
  return mutateSession(tabId, (session) => ({
    ...emptySession(tabId, session.title),
    id: uid('s'),
    recording: session.recording,
  }));
}

export function renameSession(tabId: number, title: string): Promise<Session> {
  return mutateSession(tabId, (session) => ({ ...session, title }));
}

export function deleteStep(tabId: number, stepId: string): Promise<Session> {
  return mutateSession(tabId, (session) => ({
    ...session,
    steps: session.steps.filter((s) => s.id !== stepId),
  }));
}

export function annotateStep(
  tabId: number,
  stepId: string,
  note: string,
): Promise<Session> {
  return mutateSession(tabId, (session) => ({
    ...session,
    steps: session.steps.map((s) => (s.id === stepId ? { ...s, note } : s)),
  }));
}

export async function dropSession(tabId: number): Promise<void> {
  chains.delete(tabId);
  await chrome.storage.local.remove(key(tabId));
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  exportBlob,
  FORMAT_META,
  generate,
  type LocatorStrategy,
  type OutputFormat,
} from '@/lib/codegen';
import { BASE_URL_VARIABLE, requiredVariables } from '@/lib/codegen/shared';
import { downloadBlob, downloadText, slugify } from '@/lib/download';
import { toCypressEnvFile, toEnvFile } from '@/lib/export/env';
import {
  clearDraft,
  draftSlot,
  hashOf,
  readDrafts,
  saveDraft,
  type DraftMap,
} from '@/lib/script-drafts';
import { listVariables, type TestVariable } from '@/lib/variables';
import type { Session } from '@/lib/types';
import { Badge, Button, EmptyState } from './ui';

const STRATEGY_LABEL: Record<LocatorStrategy, string> = {
  smart: 'Smart (test-id → role → XPath)',
  xpath: 'XPath only',
  css: 'CSS only',
};

/** Debounce on the draft write: a keystroke should not be a storage round trip. */
const SAVE_DELAY_MS = 400;

export function ScriptTab({ session }: { session: Session }) {
  const [format, setFormat] = useState<OutputFormat>('playwright');
  const [strategy, setStrategy] = useState<LocatorStrategy>('smart');
  const [copied, setCopied] = useState(false);
  const [variables, setVariables] = useState<TestVariable[]>([]);
  const [envNote, setEnvNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>({});
  /**
   * What is in the textarea right now. Held separately from the saved draft so
   * typing is not waiting on storage, and reset to null whenever the shown slot
   * changes — at which point the saved draft, or the generated script, takes over.
   */
  const [typed, setTyped] = useState<string | null>(null);
  const saveTimer = useRef(0);
  /** The write the debounce is holding, so unmounting can complete it rather than lose it. */
  const pending = useRef<{ value: string; generated: string; slot: string } | null>(null);
  const commitRef = useRef<() => void>(() => {});

  useEffect(() => {
    void listVariables().then(setVariables);
  }, []);

  useEffect(() => {
    void readDrafts(session.id).then(setDrafts);
  }, [session.id]);

  // A defined BASE_URL turns absolute navigations into base-relative ones, so the
  // same test can run against staging and production.
  const baseUrl = variables.find((entry) => entry.name === BASE_URL_VARIABLE)?.value;

  const options = useMemo(
    () => ({ locatorStrategy: strategy, testName: session.title, baseUrl }),
    [strategy, session.title, baseUrl],
  );

  const code = useMemo(
    () => generate([session], format, options),
    [session, format, options],
  );

  const meta = FORMAT_META[format];
  const needed = requiredVariables(session.steps, baseUrl);

  const slot = draftSlot(format, strategy, !!meta.usesLocatorStrategy);
  const draft = drafts[slot];
  // A binary format has no script, only a note explaining that — editing it
  // would produce an edit that nothing can use.
  const editable = !meta.binary;
  const text = (editable ? typed : null) ?? (editable ? draft?.text : undefined) ?? code;
  const edited = editable && (draft != null || (typed != null && typed !== code));
  // The steps have moved on since this edit was made. Not an error — the tester
  // may well want to keep it — but it must not be discovered by surprise later.
  const stale = draft != null && draft.baseHash !== hashOf(code);

  const commit = useCallback(() => {
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    // Typing the generated text back by hand is a revert, not a draft.
    const write =
      job.value === job.generated
        ? clearDraft(session.id, job.slot)
        : saveDraft(session.id, job.slot, job.value, hashOf(job.generated));
    void write.then(setDrafts);
  }, [session.id]);

  commitRef.current = commit;

  const flush = useCallback(
    (value: string, generated: string) => {
      // The slot is captured with the value: switching format while a save is in
      // flight must still write the edit to the format it was typed in.
      pending.current = { value, generated, slot };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(commit, SAVE_DELAY_MS);
    },
    [commit, slot],
  );

  // Switching format or strategy shows a different slot, so the in-progress text
  // no longer belongs to what is on screen.
  useEffect(() => {
    setTyped(null);
  }, [slot]);

  /**
   * Switching to another tab unmounts this panel, and a keystroke half a second
   * earlier is still sitting in the debounce. Cancelling that timer would throw
   * the edit away — so the pending write is completed here instead.
   */
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      commitRef.current();
    },
    [],
  );

  function revert(): void {
    window.clearTimeout(saveTimer.current);
    pending.current = null;
    setTyped(null);
    void clearDraft(session.id, slot).then(setDrafts);
  }

  if (session.steps.length === 0) {
    return (
      <EmptyState
        title="Nothing to generate"
        hint="Record a few steps first — the script is built from them as you go."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-2 dark:border-slate-700">
        <select
          value={format}
          onChange={(event) => setFormat(event.currentTarget.value as OutputFormat)}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          {Object.entries(FORMAT_META).map(([value, info]) => (
            <option key={value} value={value}>
              {info.label}
            </option>
          ))}
        </select>

        {meta.usesLocatorStrategy && (
          <select
            value={strategy}
            onChange={(event) => setStrategy(event.currentTarget.value as LocatorStrategy)}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            {Object.entries(STRATEGY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}

        <div className="flex gap-1.5">
          <Button
            variant="primary"
            disabled={meta.binary}
            title={meta.binary ? 'Binary format — nothing to copy' : undefined}
            onClick={() => {
              // What is on screen, edits and all — copying the generated version
              // while an edit is visible would be a lie.
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </Button>
          <Button
            variant={meta.binary ? 'primary' : 'ghost'}
            onClick={() =>
              downloadBlob(
                `${slugify(session.title, 'test-case')}.${meta.extension}`,
                // Same reason as Copy. A binary format cannot be edited, so it
                // still goes through the writer that produces its bytes.
                editable
                  ? new Blob([text], { type: meta.mime })
                  : exportBlob([session], format, options),
              )
            }
          >
            Download .{meta.extension}
          </Button>
        </div>
      </div>

      {needed.length > 0 && (
        <div className="border-b border-slate-200 bg-amber-50/60 px-2 py-1.5 dark:border-slate-700 dark:bg-amber-950/30">
          <p className="text-[10px] leading-relaxed text-amber-800 dark:text-amber-300">
            Set before running: <code className="font-semibold">{needed.join(', ')}</code>
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <Button
              onClick={() => {
                // Cypress reads its own JSON store, not process.env, so the file
                // it needs is a different one.
                const file =
                  format === 'cypress'
                    ? toCypressEnvFile(needed, variables)
                    : toEnvFile(needed, variables, session.title);
                downloadText(file.filename, file.content);
                setEnvNote(
                  file.blanks.length
                    ? `Saved ${file.filename} — fill in ${file.blanks.join(', ')}`
                    : `Saved ${file.filename}`,
                );
              }}
            >
              Download {format === 'cypress' ? 'cypress.env.json' : '.env'}
            </Button>
            {envNote && (
              <span className="min-w-0 truncate text-[10px] text-amber-700 dark:text-amber-400">
                {envNote}
              </span>
            )}
          </div>
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">
          {edited ? (
            <>
              <Badge tone={stale ? 'amber' : 'sky'}>✎ Edited</Badge>
              <Button onClick={revert}>Revert to generated</Button>
            </>
          ) : (
            <p className="text-[10px] text-slate-500">
              Editable — Copy and Download use what is below.
            </p>
          )}
        </div>
      )}

      {stale && (
        <p className="border-b border-amber-300 bg-amber-50/60 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          The steps have changed since this was edited, so what is below no longer
          matches the recording. Keep it, or revert to pick up the new steps.
        </p>
      )}

      <textarea
        value={text}
        readOnly={!editable}
        spellCheck={false}
        dir="ltr"
        wrap="off"
        aria-label="Generated script"
        onChange={(event) => {
          const next = event.currentTarget.value;
          setTyped(next);
          flush(next, code);
        }}
        onKeyDown={(event) => {
          // Escape is the way out for a keyboard user, since Tab is taken below.
          if (event.key === 'Escape') {
            event.currentTarget.blur();
            return;
          }
          // Tab indents rather than leaving the field, which is what anyone
          // editing code expects. Shift+Tab still moves focus.
          if (event.key !== 'Tab' || event.shiftKey || !editable) return;
          event.preventDefault();
          const area = event.currentTarget;
          const { selectionStart, selectionEnd, value } = area;
          const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
          setTyped(next);
          flush(next, code);
          // React re-renders from state, so the caret has to be restored after it.
          requestAnimationFrame(() => {
            area.selectionStart = selectionStart + 2;
            area.selectionEnd = selectionStart + 2;
          });
        }}
        className="flex-1 resize-none overflow-auto bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 outline-none read-only:text-slate-500 focus:bg-white dark:bg-slate-950 dark:text-slate-200 dark:focus:bg-slate-900"
      />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exportBlob,
  FORMAT_META,
  type LocatorStrategy,
  type OutputFormat,
} from '@/lib/codegen';
import { downloadBlob, downloadText, slugify } from '@/lib/download';
import {
  clearLibrary,
  deleteTestCase,
  importTestCases,
  libraryBytes,
  listTestCases,
  MAX_TEST_CASES,
  renameTestCase,
  saveTestCase,
  type SavedTestCase,
} from '@/lib/library';
import { BASE_URL_VARIABLE } from '@/lib/codegen/shared';
import { buildLibraryFile, parseLibraryFile } from '@/lib/library-file';
import { listVariables, type TestVariable } from '@/lib/variables';
import type { Session } from '@/lib/types';
import { Badge, Button, EmptyState } from './ui';

const STRATEGY_LABEL: Record<LocatorStrategy, string> = {
  smart: 'Smart',
  xpath: 'XPath only',
  css: 'CSS only',
};

export function LibraryTab({ session }: { session: Session | null }) {
  const [cases, setCases] = useState<SavedTestCase[]>([]);
  const [format, setFormat] = useState<OutputFormat>('playwright');
  const [strategy, setStrategy] = useState<LocatorStrategy>('smart');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bytes, setBytes] = useState(0);
  const [variables, setVariables] = useState<TestVariable[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [entries, used, vars] = await Promise.all([
      listTestCases(),
      libraryBytes(),
      listVariables(),
    ]);
    setCases(entries);
    setBytes(used);
    setVariables(vars);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const meta = FORMAT_META[format];
  const options = {
    locatorStrategy: strategy,
    testName: 'recorded flow',
    baseUrl: variables.find((entry) => entry.name === BASE_URL_VARIABLE)?.value,
  };

  function downloadOne(entry: SavedTestCase) {
    downloadBlob(
      `${slugify(entry.title, 'test-case')}.${meta.extension}`,
      exportBlob([entry.session], format, options),
    );
  }

  function downloadAll() {
    // One file holding every test case: multiple `test()` blocks for Playwright,
    // multiple `it()` for Cypress, multiple `def test_*` for Selenium. That is
    // directly runnable, unlike a folder of separate downloads.
    downloadBlob(
      `test-suite.${meta.extension}`,
      exportBlob(
        cases.map((entry) => entry.session),
        format,
        options,
      ),
    );
  }

  const canSave = session != null && session.steps.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-2 dark:border-slate-700">
        <Button
          variant="primary"
          disabled={!canSave}
          onClick={async () => {
            if (!session) return;
            try {
              await saveTestCase(session);
              await refresh();
              setStatus(`Saved "${session.title}"`);
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          + Save current recording
          {session ? ` (${session.steps.length} steps)` : ''}
        </Button>

        <div className="flex gap-1.5">
          <select
            value={format}
            onChange={(event) => setFormat(event.currentTarget.value as OutputFormat)}
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
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
              onChange={(event) =>
                setStrategy(event.currentTarget.value as LocatorStrategy)
              }
              className="min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
            >
              {Object.entries(STRATEGY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>

        {cases.length > 0 && (
          <div className="flex gap-1.5">
            <Button onClick={downloadAll}>
              Download all ({cases.length}) as one file
            </Button>
            <span
              className={`self-center text-[10px] ${
                cases.length >= MAX_TEST_CASES * 0.9 ? 'text-amber-600' : 'text-slate-400'
              }`}
            >
              {cases.length}/{MAX_TEST_CASES}
              {bytes > 0 ? ` · ${(bytes / 1024 / 1024).toFixed(1)} MB` : ''}
            </span>
            <Button
              variant="danger"
              onClick={async () => {
                await clearLibrary();
                await refresh();
                setStatus('Library cleared');
              }}
            >
              Clear library
            </Button>
          </div>
        )}

        <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-400">
            Backup &amp; team sharing
          </p>
          <div className="flex gap-1.5">
            <Button
              disabled={cases.length === 0}
              title="A single JSON file holding the whole library — the only format that can be imported back"
              onClick={() =>
                downloadText('qa-library.json', buildLibraryFile(cases))
              }
            >
              Export library file
            </Button>
            <Button onClick={() => fileInput.current?.click()}>Import library file…</Button>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
            Commit <code>qa-library.json</code> to your repo or drop it in a shared folder.
            Importing merges — nothing already here is overwritten.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              // Reset first: picking the same file twice must fire onChange again.
              event.currentTarget.value = '';
              if (!file) return;

              try {
                const incoming = parseLibraryFile(await file.text());
                const report = await importTestCases(incoming);
                await refresh();

                const parts = [`${report.added} added`];
                if (report.addedAsCopy) parts.push(`${report.addedAsCopy} as copies`);
                if (report.skippedDuplicate) {
                  parts.push(`${report.skippedDuplicate} already present`);
                }
                if (report.skippedForSpace) {
                  parts.push(`${report.skippedForSpace} skipped — library full`);
                }
                setStatus(parts.join(', '));
              } catch (error) {
                setStatus(error instanceof Error ? error.message : String(error));
              }
            }}
          />
        </div>

        {status && <p className="text-[11px] text-slate-500">{status}</p>}
      </div>

      {cases.length === 0 ? (
        <EmptyState
          title="Library is empty"
          hint="Record a scenario, then press Save current recording. Saved cases persist as full snapshots, so each one can be exported to any format later — not just the one selected when you saved it."
        />
      ) : (
        <ul className="flex-1 space-y-1.5 overflow-auto p-2">
          {cases.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900"
            >
              {renamingId === entry.id ? (
                <input
                  autoFocus
                  defaultValue={entry.title}
                  onBlur={async (event) => {
                    const title = event.currentTarget.value.trim();
                    if (title) {
                      await renameTestCase(entry.id, title);
                      await refresh();
                    }
                    setRenamingId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setRenamingId(null);
                  }}
                  className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-800"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setRenamingId(entry.id)}
                  title="Rename"
                  dir="auto"
                  className="w-full truncate text-start text-xs font-semibold hover:text-sky-600"
                >
                  {entry.title}
                </button>
              )}

              <div className="mt-1.5 flex flex-wrap gap-1">
                <Badge tone="sky">{entry.stepCount} steps</Badge>
                <Badge tone={entry.assertionCount > 0 ? 'emerald' : 'amber'}>
                  {entry.assertionCount} assertions
                </Badge>
                {entry.issueCount > 0 && (
                  <Badge tone="red">{entry.issueCount} issues</Badge>
                )}
                <Badge>{new Date(entry.savedAt).toLocaleDateString('en-GB')}</Badge>
              </div>

              {entry.origin && (
                <p className="mt-1 truncate text-[10px] text-slate-400">{entry.origin}</p>
              )}

              <div className="mt-2 flex gap-1.5">
                <Button onClick={() => downloadOne(entry)}>Download</Button>
                <Button
                  onClick={async () => {
                    await deleteTestCase(entry.id);
                    await refresh();
                    setStatus(`Deleted "${entry.title}"`);
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

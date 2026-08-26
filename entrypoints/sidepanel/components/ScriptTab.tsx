import { useEffect, useMemo, useState } from 'react';
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
import { listVariables, type TestVariable } from '@/lib/variables';
import type { Session } from '@/lib/types';
import { Button, EmptyState } from './ui';

const STRATEGY_LABEL: Record<LocatorStrategy, string> = {
  smart: 'Smart (test-id → role → XPath)',
  xpath: 'XPath only',
  css: 'CSS only',
};

export function ScriptTab({ session }: { session: Session }) {
  const [format, setFormat] = useState<OutputFormat>('playwright');
  const [strategy, setStrategy] = useState<LocatorStrategy>('smart');
  const [copied, setCopied] = useState(false);
  const [variables, setVariables] = useState<TestVariable[]>([]);
  const [envNote, setEnvNote] = useState<string | null>(null);

  useEffect(() => {
    void listVariables().then(setVariables);
  }, []);

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
              void navigator.clipboard.writeText(code).then(() => {
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
                exportBlob([session], format, options),
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

      <pre className="flex-1 overflow-auto bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200">
        {code}
      </pre>
    </div>
  );
}

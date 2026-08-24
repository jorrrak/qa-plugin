import { useMemo, useState } from 'react';
import {
  exportBlob,
  FORMAT_META,
  generate,
  type LocatorStrategy,
  type OutputFormat,
} from '@/lib/codegen';
import { requiredVariables } from '@/lib/codegen/shared';
import { downloadBlob, slugify } from '@/lib/download';
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

  const code = useMemo(
    () =>
      generate([session], format, {
        locatorStrategy: strategy,
        testName: session.title,
      }),
    [session, format, strategy],
  );

  const meta = FORMAT_META[format];
  const needed = requiredVariables(session.steps);

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
                exportBlob([session], format, {
                  locatorStrategy: strategy,
                  testName: session.title,
                }),
              )
            }
          >
            Download .{meta.extension}
          </Button>
        </div>
      </div>

      {needed.length > 0 && (
        <p className="border-b border-slate-200 bg-amber-50/60 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 dark:border-slate-700 dark:bg-amber-950/30 dark:text-amber-300">
          Set before running: <code className="font-semibold">{needed.join(', ')}</code>
        </p>
      )}

      <pre className="flex-1 overflow-auto bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200">
        {code}
      </pre>
    </div>
  );
}

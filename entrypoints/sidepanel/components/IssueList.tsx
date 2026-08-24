import type { Issue, RecordedStep } from '@/lib/types';
import { Badge, EmptyState } from './ui';

const KIND_LABEL: Record<Issue['kind'], string> = {
  'console-error': 'console error',
  'console-warning': 'console warning',
  'uncaught-error': 'uncaught error',
  'unhandled-rejection': 'unhandled rejection',
  'network-failure': 'network failure',
  'http-error': 'HTTP error',
  'resource-error': 'resource failed',
};

export function IssueList({ issues, steps }: { issues: Issue[]; steps: RecordedStep[] }) {
  if (issues.length === 0) {
    return (
      <EmptyState
        title="No issues detected"
        hint="Console errors, unhandled rejections, failed requests and 4xx/5xx responses are collected automatically — even while recording is off."
      />
    );
  }

  return (
    <ul className="space-y-1.5 p-2">
      {issues
        .slice()
        .reverse()
        .map((issue) => {
          // The step this issue followed is the whole value of pairing the
          // recorder with the detector: it names the action that broke.
          const cause = steps.find((step) => step.id === issue.nearStepId);

          return (
            <li
              key={issue.id}
              className={`rounded-lg border p-2.5 ${
                issue.severity === 'error'
                  ? 'border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/30'
                  : 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30'
              }`}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={issue.severity === 'error' ? 'red' : 'amber'}>
                  {KIND_LABEL[issue.kind]}
                </Badge>
                {issue.count > 1 && <Badge>×{issue.count}</Badge>}
                {cause && (
                  <Badge tone="sky">
                    after step {cause.seq}
                    {cause.target?.textName ? ` — ${cause.target.textName}` : ''}
                  </Badge>
                )}
              </div>

              <p className="break-words font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                {issue.message}
              </p>

              {issue.detail && (
                <p className="mt-1 truncate text-[10px] text-slate-400">{issue.detail}</p>
              )}
            </li>
          );
        })}
    </ul>
  );
}

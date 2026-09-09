import { useState } from 'react';
import { IssueList } from './components/IssueList';
import { LibraryTab } from './components/LibraryTab';
import { ScriptTab } from './components/ScriptTab';
import { StepList } from './components/StepList';
import { ToolsTab } from './components/ToolsTab';
import { Badge, Button } from './components/ui';
import { isAssertion } from '@/lib/types';
import { isRecordableUrl, shortUrl } from '@/lib/url';
import { useSession } from './use-session';

type TabKey = 'record' | 'script' | 'library' | 'issues' | 'tools';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'record', label: 'Record' },
  { key: 'script', label: 'Script' },
  { key: 'library', label: 'Library' },
  { key: 'issues', label: 'Issues' },
  { key: 'tools', label: 'Tools' },
];

export function App() {
  const { tabId, url, session, act } = useSession();
  const [tab, setTab] = useState<TabKey>('record');
  const [renaming, setRenaming] = useState(false);

  const recording = session?.recording ?? false;
  const errorCount = session?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const assertionCount =
    session?.steps.filter((step) => isAssertion(step.action)).length ?? 0;
  // A tester needs to see what the recording will open before pressing record.
  // Without it a chrome:// tab, the Web Store or a PDF viewer looked identical
  // to a normal page, and recording there fails silently.
  const recordable = isRecordableUrl(url);

  return (
    <div className="flex h-full flex-col bg-slate-50 font-sans text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="space-y-2 border-b border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
        {renaming && session ? (
          <input
            autoFocus
            defaultValue={session.title}
            onBlur={(event) => {
              const title = event.currentTarget.value.trim();
              if (title && tabId != null) void act({ type: 'renameSession', tabId, title });
              setRenaming(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setRenaming(false);
            }}
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-800"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title="Rename test case"
            dir="auto"
            className="w-full truncate text-start text-sm font-semibold hover:text-sky-600"
          >
            {session?.title ?? 'Loading…'}
          </button>
        )}

        {recordable ? (
          <p
            dir="ltr"
            title={url}
            className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400"
          >
            {shortUrl(url)}
          </p>
        ) : (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {url
              ? 'This page cannot be recorded — Chrome blocks extensions on it. Open an http(s) page.'
              : 'No page selected.'}
          </p>
        )}

        <div className="flex items-center gap-1.5">
          {recording ? (
            <Button
              variant="danger"
              onClick={() => tabId != null && void act({ type: 'stopRecording', tabId })}
            >
              ■ Stop recording
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={tabId == null || !recordable}
              onClick={() => tabId != null && void act({ type: 'startRecording', tabId })}
            >
              ● Start recording
            </Button>
          )}
          <Button
            disabled={!session || session.steps.length + session.issues.length === 0}
            onClick={() => tabId != null && void act({ type: 'clearSession', tabId })}
          >
            Clear
          </Button>

          <div className="ms-auto flex items-center gap-1">
            <Badge tone="sky">{session?.steps.length ?? 0} steps</Badge>
            {assertionCount > 0 && <Badge tone="emerald">{assertionCount} ✓</Badge>}
            {errorCount > 0 && <Badge tone="red">{errorCount} errors</Badge>}
          </div>
        </div>
      </header>

      <nav className="flex border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={`flex-1 border-b-2 px-1 py-2 text-[11px] font-medium transition ${
              tab === entry.key
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {entry.label}
            {entry.key === 'issues' && errorCount > 0 && (
              <span className="ms-1 text-red-500">•</span>
            )}
          </button>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-auto">
        {!session ? null : tab === 'record' ? (
          <StepList
            steps={session.steps}
            recording={recording}
            onDelete={(stepId) =>
              tabId != null && void act({ type: 'deleteStep', tabId, stepId })
            }
            onUpdate={(stepId, patch) =>
              tabId != null && void act({ type: 'updateStep', tabId, stepId, patch })
            }
            onMove={(stepId, direction) =>
              tabId != null && void act({ type: 'moveStep', tabId, stepId, direction })
            }
            onInsert={(afterStepId, step) =>
              tabId != null && void act({ type: 'insertStep', tabId, afterStepId, step })
            }
          />
        ) : tab === 'script' ? (
          <ScriptTab session={session} />
        ) : tab === 'library' ? (
          <LibraryTab session={session} />
        ) : tab === 'issues' ? (
          <IssueList issues={session.issues} steps={session.steps} />
        ) : (
          <ToolsTab tabId={tabId} />
        )}
      </main>
    </div>
  );
}

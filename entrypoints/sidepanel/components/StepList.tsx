import { useState } from 'react';
import { isAssertion, type RecordedStep } from '@/lib/types';
import { Badge, Button, CopyableCode, EmptyState } from './ui';

const ACTION_LABEL: Record<RecordedStep['action'], string> = {
  click: 'Click',
  dblclick: 'Double-click',
  fill: 'Type',
  select: 'Select',
  check: 'Check',
  uncheck: 'Uncheck',
  press: 'Press',
  submit: 'Submit',
  navigate: 'Go to',
  scrollTo: 'Scroll to',
  scrollToBottom: 'Scroll to load more',
  assertText: 'Assert element text',
  assertTextPresent: 'Assert text on page',
  assertValue: 'Assert value',
  assertVisible: 'Assert visible',
  assertHidden: 'Assert hidden',
  assertUrl: 'Assert URL',
};

const KIND_LABEL: Record<string, string> = {
  button: 'button',
  link: 'link',
  input: 'field',
  textarea: 'textarea',
  select: 'select',
  checkbox: 'checkbox',
  radio: 'radio',
  other: 'element',
};

/**
 * Two identical buttons in two different iframes look the same in the list, so
 * the frame has to be on screen. Top-frame steps get no badge — that is the
 * common case and labelling it would be noise.
 */
function frameLabel(step: RecordedStep): string | undefined {
  const path = step.framePath ?? [];
  if (path.length === 0) return undefined;
  if (path.some((ref) => ref.unresolved)) return '⚠ unidentified iframe';
  const last = path[path.length - 1]!;
  const name = last.name ?? last.selector;
  const depth = path.length > 1 ? ` +${path.length - 1}` : '';
  return `iframe: ${name}${depth}`;
}

function StepCard({
  step,
  onDelete,
  onAnnotate,
}: {
  step: RecordedStep;
  onDelete: () => void;
  onAnnotate: (note: string) => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const target = step.target;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 min-w-5 shrink-0 text-center font-mono text-[11px] text-slate-400">
          {step.seq}
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={isAssertion(step.action) ? 'emerald' : 'sky'}>
              {isAssertion(step.action) ? '✓ ' : ''}
              {ACTION_LABEL[step.action]}
            </Badge>
            {target && <Badge>{KIND_LABEL[target.elementKind] ?? target.elementKind}</Badge>}
            {target && !target.unique && <Badge tone="amber">ambiguous locator</Badge>}
            {step.sensitive && <Badge tone="emerald">password — not stored</Badge>}
            {step.typeSequentially && (
              <Badge tone="amber" >typed key by key</Badge>
            )}
            {frameLabel(step) && (
              <Badge tone={step.framePath?.some((f) => f.unresolved) ? 'red' : 'amber'}>
                {frameLabel(step)}
              </Badge>
            )}
          </div>

          {/* The element name comes from the page, so it may well be RTL even
              though the UI is not. `dir="auto"` lets each name pick its own. */}
          <p
            dir="auto"
            className="truncate text-sm font-medium text-slate-800 dark:text-slate-100"
          >
            {target?.textName || step.value || '(no visible text)'}
          </p>

          {step.variable ? (
            <p className="truncate font-mono text-[11px] text-sky-600 dark:text-sky-400">
              → ${'{'}
              {step.variable}
              {'}'}
            </p>
          ) : (
            step.value &&
            !step.sensitive &&
            step.action !== 'navigate' && (
              <p dir="auto" className="truncate text-[11px] text-slate-500">
                → {step.value}
              </p>
            )
          )}

          {target && <CopyableCode value={target.xpath} />}

          {target?.testId && (
            <p className="text-[10px] text-emerald-600">data-testid: {target.testId}</p>
          )}

          {editingNote ? (
            <input
              autoFocus
              defaultValue={step.note ?? ''}
              placeholder="Note for this step…"
              onBlur={(event) => {
                onAnnotate(event.currentTarget.value.trim());
                setEditingNote(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setEditingNote(false);
              }}
              className="w-full rounded border border-slate-300 px-1.5 py-1 text-[11px] outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-800"
            />
          ) : (
            step.note && <p className="text-[11px] italic text-slate-500">{step.note}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <Button title="Add a note" onClick={() => setEditingNote(true)}>
            ✎
          </Button>
          <Button title="Delete this step" onClick={onDelete}>
            ✕
          </Button>
        </div>
      </div>
    </li>
  );
}

export function StepList({
  steps,
  recording,
  onDelete,
  onAnnotate,
}: {
  steps: RecordedStep[];
  recording: boolean;
  onDelete: (stepId: string) => void;
  onAnnotate: (stepId: string, note: string) => void;
}) {
  if (steps.length === 0) {
    return (
      <EmptyState
        title={recording ? 'Recording — go use the page' : 'Nothing recorded yet'}
        hint={
          recording
            ? 'Every click, keystroke and navigation is captured with the element XPath and its visible name. Right-click an element to add an assertion.'
            : 'Press Start recording, then run your scenario in the active tab.'
        }
      />
    );
  }

  return (
    <ul className="space-y-1.5 p-2">
      {steps.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          onDelete={() => onDelete(step.id)}
          onAnnotate={(note) => onAnnotate(step.id, note)}
        />
      ))}
    </ul>
  );
}

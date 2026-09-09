import { useState } from 'react';
import { isAssertion, MAX_STEPS, type RecordedStep, type StepPatch } from '@/lib/types';
import { AddAssertion, StepEditor } from './StepEditor';
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
  scrollPosition: 'Scroll (by position)',
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

/** What the step's headline says when the element has no visible text. */
function headline(step: RecordedStep): string {
  if (step.target?.textName) return step.target.textName;
  if (step.action === 'scrollPosition') {
    const where = step.scrollContainer?.textName;
    return `${step.scrollOffset ?? 0} px${where ? ` in “${where}”` : ''}`;
  }
  if (step.action === 'scrollToBottom') {
    const where = step.scrollContainer?.textName;
    return `${step.repeat ?? 1}× to load more${where ? ` in “${where}”` : ''}`;
  }
  return step.value || '(no visible text)';
}

interface StepActions {
  onDelete: () => void;
  onUpdate: (patch: StepPatch) => void;
  onMove: (direction: 'up' | 'down') => void;
  onInsert: (afterStepId: string, step: Omit<RecordedStep, 'seq'>) => void;
}

function StepCard({
  step,
  first,
  last,
  full,
  actions,
}: {
  step: RecordedStep;
  first: boolean;
  last: boolean;
  full: boolean;
  actions: StepActions;
}) {
  const [editing, setEditing] = useState(false);
  const target = step.target;
  const locator = target ?? step.scrollContainer;

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
            {step.typeSequentially && <Badge tone="amber">typed key by key</Badge>}
            {/* Worth flagging: the generated step scrolls that element, not the page. */}
            {step.scrollContainer && <Badge tone="amber">in a scrollable area</Badge>}
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
            {headline(step)}
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

          {locator && <CopyableCode value={locator.xpath} />}

          {target?.testId && (
            <p className="text-[10px] text-emerald-600">data-testid: {target.testId}</p>
          )}

          {!editing && step.note && (
            <p dir="auto" className="text-[11px] italic text-slate-500">
              {step.note}
            </p>
          )}

          {editing && (
            <StepEditor
              step={step}
              full={full}
              onUpdate={actions.onUpdate}
              onInsert={actions.onInsert}
              onClose={() => setEditing(false)}
            />
          )}
        </div>

        {/* Two by two rather than a column: four stacked buttons set a minimum
            card height taller than most steps' own content. */}
        <div className="grid shrink-0 grid-cols-2 gap-1">
          <Button compact title="Move up" disabled={first} onClick={() => actions.onMove('up')}>
            ↑
          </Button>
          <Button compact title="Move down" disabled={last} onClick={() => actions.onMove('down')}>
            ↓
          </Button>
          <Button
            compact
            title="Edit this step, or add an assertion after it"
            onClick={() => setEditing((open) => !open)}
          >
            ✎
          </Button>
          <Button compact title="Delete this step" onClick={actions.onDelete}>
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
  onUpdate,
  onMove,
  onInsert,
}: {
  steps: RecordedStep[];
  recording: boolean;
  onDelete: (stepId: string) => void;
  onUpdate: (stepId: string, patch: StepPatch) => void;
  onMove: (stepId: string, direction: 'up' | 'down') => void;
  onInsert: (afterStepId: string, step: Omit<RecordedStep, 'seq'>) => void;
}) {
  const [appending, setAppending] = useState(false);

  if (steps.length === 0) {
    return (
      <EmptyState
        title={recording ? 'Recording — go use the page' : 'Nothing recorded yet'}
        hint={
          recording
            ? 'Every click, keystroke, scroll and navigation is captured with the element XPath and its visible name. Right-click an element to add an assertion.'
            : 'Press Start recording, then run your scenario in the active tab.'
        }
      />
    );
  }

  const lastStep = steps[steps.length - 1]!;
  // Inserting past the cap is refused by the store; say so rather than no-op.
  const full = steps.length >= MAX_STEPS;

  return (
    <div className="space-y-1.5 p-2">
      <ul className="space-y-1.5">
        {steps.map((step, index) => (
          <StepCard
            key={step.id}
            step={step}
            first={index === 0}
            last={index === steps.length - 1}
            full={full}
            actions={{
              onDelete: () => onDelete(step.id),
              onUpdate: (patch) => onUpdate(step.id, patch),
              onMove: (direction) => onMove(step.id, direction),
              onInsert,
            }}
          />
        ))}
      </ul>

      {full ? (
        <p className="px-1 text-[11px] text-amber-600 dark:text-amber-400">
          This test case holds the maximum of {MAX_STEPS} steps. Delete one to add
          an assertion.
        </p>
      ) : appending ? (
        <AddAssertion
          anchor={lastStep}
          onInsert={onInsert}
          onDone={() => setAppending(false)}
        />
      ) : (
        <Button onClick={() => setAppending(true)}>+ Add an assertion at the end</Button>
      )}
    </div>
  );
}

import { useState } from 'react';
import { uid } from '@/lib/id';
import type { AssertAction, RecordedStep, StepPatch } from '@/lib/types';
import { Button } from './ui';

/**
 * Editing a recorded test case after the fact.
 *
 * A recording is a first draft. The assertion a tester thinks of is almost never
 * the one they thought of while clicking — it arrives afterwards, reading the
 * steps back. Before this, the only way to add one was to record the whole flow
 * again with the right-click menu at the right moment.
 *
 * What is editable is deliberately narrow: text a person wrote or expected, and
 * the order of steps. Locators, frame paths and timestamps are the record of
 * what actually happened and are not writable from here.
 */

interface AssertOption {
  kind: AssertAction;
  label: string;
  /** Whether the assertion needs an expected value typed alongside it. */
  needsValue: boolean;
  placeholder?: string;
  /** True when the assertion is about a specific element. */
  needsTarget: boolean;
}

const ASSERT_OPTIONS: AssertOption[] = [
  {
    kind: 'assertTextPresent',
    label: 'Text appears on the page',
    needsValue: true,
    placeholder: 'Order confirmed',
    needsTarget: false,
  },
  {
    kind: 'assertUrl',
    label: 'Page URL is',
    needsValue: true,
    placeholder: 'https://shop.example/checkout/done',
    needsTarget: false,
  },
  {
    kind: 'assertVisible',
    label: 'This element is visible',
    needsValue: false,
    needsTarget: true,
  },
  {
    kind: 'assertHidden',
    label: 'This element is hidden',
    needsValue: false,
    needsTarget: true,
  },
  {
    kind: 'assertText',
    label: "This element's text is",
    needsValue: true,
    placeholder: 'Saved',
    needsTarget: true,
  },
  {
    kind: 'assertValue',
    label: "This field's value is",
    needsValue: true,
    placeholder: '09361003399',
    needsTarget: true,
  },
];

const field =
  'w-full rounded border border-slate-300 px-1.5 py-1 text-[11px] outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-800';

/**
 * A value is editable only when the recorder is not deliberately holding the
 * real one. A password was never captured, and a variable reference is changed
 * under Test data — typing a literal over either would put a credential into the
 * session and into every export made from it.
 */
export function valueIsEditable(step: RecordedStep): boolean {
  if (step.sensitive || step.variable) return false;
  return (
    step.action === 'fill' ||
    step.action === 'select' ||
    step.action === 'navigate' ||
    step.action === 'assertText' ||
    step.action === 'assertTextPresent' ||
    step.action === 'assertValue' ||
    step.action === 'assertUrl'
  );
}

function valueLabel(step: RecordedStep): string {
  if (step.action === 'navigate') return 'URL';
  if (step.action === 'assertUrl') return 'Expected URL';
  if (step.action.startsWith('assert')) return 'Expected';
  return 'Value';
}

/** The form for adding an assertion, either after a step or at the end. */
export function AddAssertion({
  anchor,
  onInsert,
  onDone,
}: {
  /** The step the new assertion goes after, and whose element it can reuse. */
  anchor: RecordedStep;
  onInsert: (afterStepId: string, step: Omit<RecordedStep, 'seq'>) => void;
  onDone: () => void;
}) {
  const target = anchor.target;
  const options = ASSERT_OPTIONS.filter((option) => !option.needsTarget || target);
  const [kind, setKind] = useState<AssertAction>(options[0]!.kind);
  const [value, setValue] = useState('');

  const option = options.find((entry) => entry.kind === kind) ?? options[0]!;
  const ready = !option.needsValue || value.trim().length > 0;

  function add(): void {
    if (!ready) return;
    onInsert(anchor.id, {
      id: uid('step'),
      action: option.kind,
      // An element assertion reuses the anchor's element and its iframe, which
      // is the whole reason it is offered per-step rather than in one global
      // form: there is no element picker here, and this needs none.
      target: option.needsTarget ? target : undefined,
      framePath: option.needsTarget ? anchor.framePath : undefined,
      value: option.needsValue ? value.trim() : undefined,
      url: anchor.url,
      timestamp: Date.now(),
    });
    setValue('');
    onDone();
  }

  return (
    <div className="space-y-1.5 rounded-md border border-emerald-300 bg-emerald-50/60 p-2 dark:border-emerald-800 dark:bg-emerald-950/30">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        Assert after step {anchor.seq}
      </p>

      <select
        value={kind}
        onChange={(event) => setKind(event.currentTarget.value as AssertAction)}
        className={field}
      >
        {options.map((entry) => (
          <option key={entry.kind} value={entry.kind}>
            {entry.label}
          </option>
        ))}
      </select>

      {option.needsTarget && target && (
        <p dir="auto" className="truncate text-[10px] text-slate-500">
          on “{target.textName || target.tagName}”
        </p>
      )}

      {option.needsValue && (
        <input
          autoFocus
          dir="auto"
          value={value}
          placeholder={option.placeholder}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
            if (event.key === 'Escape') onDone();
          }}
          className={field}
        />
      )}

      <div className="flex gap-1">
        <Button variant="primary" disabled={!ready} onClick={add}>
          Add assertion
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

/** The drawer under a step: its note, its value, and where an assertion goes. */
export function StepEditor({
  step,
  full,
  onUpdate,
  onInsert,
  onClose,
}: {
  step: RecordedStep;
  /** The test case is at the step cap, so nothing more can be inserted. */
  full: boolean;
  onUpdate: (patch: StepPatch) => void;
  onInsert: (afterStepId: string, next: Omit<RecordedStep, 'seq'>) => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const editable = valueIsEditable(step);

  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700">
      {editable ? (
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {valueLabel(step)}
          </span>
          <input
            dir="auto"
            defaultValue={step.value ?? ''}
            onBlur={(event) => onUpdate({ value: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            className={field}
          />
        </label>
      ) : (
        (step.sensitive || step.variable) && (
          <p className="text-[10px] leading-relaxed text-slate-500">
            {step.sensitive
              ? 'The password was never captured, so there is nothing to edit here. The script reads TEST_PASSWORD from the environment.'
              : `This value comes from the ${step.variable} variable — change it under Tools → Test data.`}
          </p>
        )
      )}

      {step.action === 'press' && (
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Key
          </span>
          <input
            dir="ltr"
            defaultValue={step.key ?? ''}
            placeholder="Enter, Tab, Control+A"
            onBlur={(event) => onUpdate({ key: event.currentTarget.value })}
            onKeyDown={(event) => {
              // Not a key *capture* field: typing "Enter" here should not submit.
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
            className={field}
          />
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Note
        </span>
        <input
          dir="auto"
          defaultValue={step.note ?? ''}
          placeholder="Becomes a comment in the generated script"
          onBlur={(event) => onUpdate({ note: event.currentTarget.value.trim() })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className={field}
        />
      </label>

      {adding ? (
        <AddAssertion anchor={step} onInsert={onInsert} onDone={() => setAdding(false)} />
      ) : (
        <div className="flex gap-1">
          <Button disabled={full} onClick={() => setAdding(true)}>
            + Assertion after this
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      )}
    </div>
  );
}

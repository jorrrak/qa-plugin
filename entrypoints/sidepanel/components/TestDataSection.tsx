import { useCallback, useEffect, useState } from 'react';
import {
  deleteVariable,
  listVariables,
  MAX_VARIABLES,
  normaliseName,
  saveVariable,
  type TestVariable,
} from '@/lib/variables';
import { Badge, Button } from './ui';

/**
 * Where the fixed test phone number and password are defined once. While
 * recording, a typed value matching one of these is stored as a reference, so the
 * literal never reaches a script, a spreadsheet, or a shared file.
 */
export function TestDataSection() {
  const [variables, setVariables] = useState<TestVariable[]>([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [secret, setSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setVariables(await listVariables());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add() {
    setError(null);
    try {
      setVariables(await saveVariable({ name, value, secret }));
      setName('');
      setValue('');
      setSecret(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <h3 className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
        Test data
      </h3>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        Define the values your scenarios reuse — a test phone number, an account, a
        password. While recording, a field you fill with one of these is stored as a
        reference instead of the literal, and generated scripts read it from the
        environment.
      </p>

      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            onBlur={(event) => setName(normaliseName(event.currentTarget.value))}
            placeholder="TEST_PHONE"
            className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px] outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <input
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            type={secret ? 'password' : 'text'}
            placeholder="value"
            className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-[11px] outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-800"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={secret}
              onChange={(event) => setSecret(event.currentTarget.checked)}
            />
            secret
          </label>
          <Button
            variant="primary"
            disabled={!name || !value || variables.length >= MAX_VARIABLES}
            onClick={() => void add()}
          >
            Add
          </Button>
          <span className="text-[10px] text-slate-400">
            {variables.length}/{MAX_VARIABLES}
          </span>
        </div>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>

      {variables.length > 0 && (
        <ul className="mt-2 space-y-1">
          {variables.map((variable) => (
            <li
              key={variable.name}
              className="flex items-center gap-1.5 rounded bg-slate-50 px-1.5 py-1 dark:bg-slate-800/60"
            >
              <code className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                {variable.name}
              </code>
              {variable.secret && <Badge tone="amber">secret</Badge>}
              <span
                dir="auto"
                className="min-w-0 flex-1 truncate text-end text-[11px] text-slate-500"
              >
                {variable.secret && revealed !== variable.name
                  ? '••••••••'
                  : variable.value}
              </span>
              {variable.secret && (
                <Button
                  title={revealed === variable.name ? 'Hide' : 'Show'}
                  onClick={() =>
                    setRevealed(revealed === variable.name ? null : variable.name)
                  }
                >
                  {revealed === variable.name ? '🙈' : '👁'}
                </Button>
              )}
              <Button
                title="Delete"
                onClick={async () => setVariables(await deleteVariable(variable.name))}
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        Stored unencrypted in this Chrome profile, and never written into an export
        or a library file — only the name travels. Use test-account credentials
        only, never a real user's.
      </p>
    </section>
  );
}

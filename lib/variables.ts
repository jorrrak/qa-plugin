/**
 * Named test data — the fixed phone number, account, and password a QA team
 * reuses across scenarios.
 *
 * The point is substitution at *record* time. When a typed value matches a
 * variable, the step stores the variable's name and never the literal. That
 * keeps one credential out of every recorded script and every exported sheet,
 * and it is the only way a password can be referenced at all: the recorder
 * compares the field's contents in memory and stores nothing but the name.
 */

const KEY = 'variables';

/** Enough for a team's fixtures; a guard against an accidental paste loop. */
export const MAX_VARIABLES = 50;

export interface TestVariable {
  /** Used verbatim as the environment-variable name in generated scripts. */
  name: string;
  value: string;
  /**
   * Secret values are never written into an export or a library file — only the
   * name travels. Generated scripts read them from the environment.
   */
  secret: boolean;
}

/** Environment-variable naming, so the generated code needs no mangling. */
export const NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function normaliseName(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

export async function listVariables(): Promise<TestVariable[]> {
  const stored = await chrome.storage.local.get(KEY);
  const variables = (stored[KEY] as TestVariable[] | undefined) ?? [];
  return variables.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function saveVariable(variable: TestVariable): Promise<TestVariable[]> {
  return serialize(async () => {
    const name = normaliseName(variable.name);
    if (!NAME_PATTERN.test(name)) {
      throw new Error('Name must start with a letter and use A-Z, 0-9 and _ only.');
    }
    if (!variable.value) throw new Error('Value cannot be empty.');

    const existing = await listVariables();
    const without = existing.filter((entry) => entry.name !== name);
    if (without.length >= MAX_VARIABLES) {
      throw new Error(`At most ${MAX_VARIABLES} variables.`);
    }

    const next = [...without, { ...variable, name }];
    await chrome.storage.local.set({ [KEY]: next });
    return next.slice().sort((a, b) => a.name.localeCompare(b.name));
  });
}

export function deleteVariable(name: string): Promise<TestVariable[]> {
  return serialize(async () => {
    const next = (await listVariables()).filter((entry) => entry.name !== name);
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
}

/**
 * The variable a value came from, if any. Longest value first: if one variable's
 * value is a prefix of another's, the more specific match is the right one.
 */
export function matchVariable(
  value: string,
  variables: TestVariable[],
): TestVariable | undefined {
  if (!value) return undefined;
  return variables
    .slice()
    .sort((a, b) => b.value.length - a.value.length)
    .find((entry) => entry.value === value);
}

/** Variables a set of steps actually references, for the "you will need" list. */
export function variablesUsedBy(names: (string | undefined)[]): string[] {
  return [...new Set(names.filter((name): name is string => !!name))].sort();
}

import type { SavedTestCase } from './library';
import type { RecordedStep, Session } from './types';

/**
 * The interchange file: one JSON document holding a whole library, meant to be
 * committed to the team's repository or dropped in a shared folder.
 *
 * It carries an explicit format tag and version because it will outlive this
 * build. Reading a file the current code does not understand must fail with a
 * sentence a person can act on, not a `TypeError` from somewhere deep in a map().
 */

export const LIBRARY_FILE_FORMAT = 'qa-plugin-library';
export const LIBRARY_FILE_VERSION = 1;

export interface LibraryFile {
  format: typeof LIBRARY_FILE_FORMAT;
  version: number;
  exportedAt: number;
  testCases: SavedTestCase[];
}

export function buildLibraryFile(cases: SavedTestCase[]): string {
  const file: LibraryFile = {
    format: LIBRARY_FILE_FORMAT,
    version: LIBRARY_FILE_VERSION,
    exportedAt: Date.now(),
    testCases: cases,
  };
  // Pretty-printed on purpose: this file lands in git, and a diff of one changed
  // step should not show up as one enormous changed line.
  return JSON.stringify(file, null, 2);
}

export class LibraryFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryFileError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps a malformed step from reaching the panel and breaking the render. */
function isStep(value: unknown): value is RecordedStep {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.seq === 'number' &&
    typeof value.action === 'string' &&
    typeof value.url === 'string'
  );
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.steps) &&
    Array.isArray(value.issues) &&
    value.steps.every(isStep)
  );
}

function isTestCase(value: unknown): value is SavedTestCase {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.savedAt === 'number' &&
    isSession(value.session)
  );
}

export function parseLibraryFile(text: string): SavedTestCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LibraryFileError('That file is not valid JSON.');
  }

  if (!isRecord(parsed)) {
    throw new LibraryFileError('That file does not contain a library object.');
  }

  if (parsed.format !== LIBRARY_FILE_FORMAT) {
    // The most likely mistake is picking a "Raw session (JSON)" export, which is
    // a different shape entirely — say so instead of "invalid file".
    throw new LibraryFileError(
      'Not a library file. Export one with "Export library file" — a single-session JSON export cannot be imported.',
    );
  }

  if (typeof parsed.version !== 'number' || parsed.version > LIBRARY_FILE_VERSION) {
    throw new LibraryFileError(
      `This file was written by a newer version of the extension (format v${String(
        parsed.version,
      )}, this build reads v${LIBRARY_FILE_VERSION}). Update the extension.`,
    );
  }

  if (!Array.isArray(parsed.testCases)) {
    throw new LibraryFileError('The library file has no testCases array.');
  }

  const valid = parsed.testCases.filter(isTestCase);
  if (valid.length === 0) {
    throw new LibraryFileError('The library file contains no readable test cases.');
  }

  return valid;
}

/**
 * Content fingerprint, ignoring id and timestamps. Two people recording the same
 * flow produce different ids, so identity by id alone would import the same test
 * case twice; and re-importing the same file must not duplicate anything.
 */
export function fingerprint(entry: SavedTestCase): string {
  const shape = entry.session.steps.map(
    (step) => `${step.action}|${step.target?.xpath ?? ''}|${step.value ?? ''}`,
  );
  return `${entry.title}::${shape.join('>')}`;
}

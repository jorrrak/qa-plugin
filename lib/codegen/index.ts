import type { Session } from '../types';
import { toCsv } from '../export/csv';
import { toXlsx } from '../export/xlsx';
import { toYaml } from '../export/yaml';
import { toZephyrCsv, toZephyrXlsx } from '../export/zephyr';
import { toCypress } from './cypress';
import { toMarkdown } from './markdown';
import { toPlaywright } from './playwright';
import { toSeleniumPython } from './selenium-python';
import type { CodegenOptions } from './shared';

export type { CodegenOptions, LocatorStrategy } from './shared';

export type OutputFormat =
  | 'playwright'
  | 'cypress'
  | 'selenium-python'
  | 'markdown'
  | 'csv'
  | 'xlsx'
  | 'yaml'
  | 'zephyr-csv'
  | 'zephyr-xlsx'
  | 'json';

export const FORMAT_META: Record<
  OutputFormat,
  {
    label: string;
    language: string;
    extension: string;
    mime: string;
    /** True when the output is bytes, not text — no preview, no clipboard. */
    binary?: true;
    /** Whether a locator strategy applies. Spreadsheets carry every locator. */
    usesLocatorStrategy?: true;
  }
> = {
  playwright: {
    label: 'Playwright (TS)', language: 'typescript', extension: 'spec.ts',
    mime: 'text/plain;charset=utf-8', usesLocatorStrategy: true,
  },
  cypress: {
    label: 'Cypress (JS)', language: 'javascript', extension: 'cy.js',
    mime: 'text/plain;charset=utf-8', usesLocatorStrategy: true,
  },
  'selenium-python': {
    label: 'Selenium (Python)', language: 'python', extension: 'py',
    mime: 'text/plain;charset=utf-8', usesLocatorStrategy: true,
  },
  markdown: {
    label: 'Test case (Markdown)', language: 'markdown', extension: 'md',
    mime: 'text/markdown;charset=utf-8',
  },
  csv: {
    label: 'Spreadsheet (CSV)', language: 'csv', extension: 'csv',
    mime: 'text/csv;charset=utf-8',
  },
  xlsx: {
    label: 'Excel workbook (.xlsx)', language: 'binary', extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    binary: true,
  },
  yaml: {
    label: 'Test cases (YAML)', language: 'yaml', extension: 'yaml',
    mime: 'text/yaml;charset=utf-8',
  },
  'zephyr-csv': {
    label: 'Zephyr Scale (CSV)', language: 'csv', extension: 'zephyr.csv',
    mime: 'text/csv;charset=utf-8',
  },
  'zephyr-xlsx': {
    label: 'Zephyr Scale (Excel)', language: 'binary', extension: 'zephyr.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    binary: true,
  },
  json: {
    label: 'Raw session (JSON)', language: 'json', extension: 'json',
    mime: 'application/json;charset=utf-8',
  },
};

/**
 * Text output. For a binary format this returns a short note instead, so the
 * preview pane has something honest to show rather than raw bytes.
 */
export function generate(
  sessions: Session[],
  format: OutputFormat,
  options: CodegenOptions,
): string {
  switch (format) {
    case 'playwright':
      return toPlaywright(sessions, options);
    case 'cypress':
      return toCypress(sessions, options);
    case 'selenium-python':
      return toSeleniumPython(sessions, options);
    case 'markdown':
      return toMarkdown(sessions);
    case 'csv':
      return toCsv(sessions);
    case 'yaml':
      return toYaml(sessions);
    case 'zephyr-csv':
      return toZephyrCsv(sessions);
    case 'json':
      return JSON.stringify(sessions.length === 1 ? sessions[0] : sessions, null, 2);
    case 'zephyr-xlsx':
      return [
        'Zephyr Scale workbook — binary, nothing to preview here.',
        '',
        'One sheet of test cases in the shape Zephyr Scale\'s importer expects:',
        '  Name, Objective, Precondition, then one row per step with',
        '  Step / Test Data / Expected Result.',
        '',
        'Switch to "Zephyr Scale (CSV)" to read the same content here.',
        'Press Download to save it.',
      ].join('\n');
    case 'xlsx':
      return [
        'Excel workbook — binary, nothing to preview here.',
        '',
        'Two sheets:',
        '  Steps   — one row per recorded step, with XPath, CSS selector, test id,',
        '            element name, frame and value',
        '  Issues  — one row per detected bug, linked to the step it followed',
        '',
        'The header row is frozen and an autofilter is applied on both sheets.',
        'Press Download to save it.',
      ].join('\n');
  }
}

/** The bytes to hand to a download, for text and binary formats alike. */
export function exportBlob(
  sessions: Session[],
  format: OutputFormat,
  options: CodegenOptions,
): Blob {
  const meta = FORMAT_META[format];
  if (format === 'xlsx' || format === 'zephyr-xlsx') {
    // Copy into a fresh ArrayBuffer: the typed array's buffer may be larger than
    // the view, and Blob would otherwise include the slack bytes.
    const bytes = format === 'zephyr-xlsx' ? toZephyrXlsx(sessions) : toXlsx(sessions);
    return new Blob([bytes.slice().buffer as ArrayBuffer], { type: meta.mime });
  }
  return new Blob([generate(sessions, format, options)], { type: meta.mime });
}

import { issuesTable, stepsTable, type Table } from './rows';
import type { Session } from '../types';

/**
 * Excel decides a CSV's encoding by sniffing, and without a BOM it reads UTF-8
 * as the local 8-bit codepage — which turns every Persian title into mojibake.
 * The BOM is three bytes and removes the whole problem.
 */
const BOM = '﻿';

function cell(value: string | number): string {
  const text = String(value);
  // Quote whenever the value could otherwise break the row, and double any
  // embedded quote — RFC 4180.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function serialise(table: Table): string {
  return [table.headers, ...table.rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

/** Any table as a standalone CSV, BOM included. */
export function tableToCsv(table: Table): string {
  return `${BOM}${serialise(table)}\r\n`;
}

export function toCsv(sessions: Session[]): string {
  const steps = serialise(stepsTable(sessions));
  const issues = issuesTable(sessions);

  // One file, so the issues follow the steps under their own header rather than
  // being silently dropped.
  if (issues.rows.length === 0) return BOM + steps + '\r\n';

  return `${BOM}${steps}\r\n\r\n${serialise(issues)}\r\n`;
}

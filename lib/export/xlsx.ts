import type { Session } from '../types';
import { issuesTable, stepsTable, type Table } from './rows';
import { zipStore, type ZipEntry } from './zip';

/** Column letter for a 0-based index: 0 → A, 26 → AA. */
function columnName(index: number): string {
  let name = '';
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/** Characters XML 1.0 forbids outright. Excel calls a file with one corrupt. */
const ILLEGAL_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

function xmlEscape(value: string): string {
  return value
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellXml(ref: string, value: string | number): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const text = xmlEscape(String(value));
  if (!text) return `<c r="${ref}"/>`;
  // Inline strings avoid a sharedStrings part entirely — fewer moving pieces for
  // a file this size.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

/** Width roughly fitted to the widest value, so nothing opens as ####. */
function columnWidths(table: Table): string {
  const widths = table.headers.map((header, column) => {
    const longest = table.rows.reduce(
      (max, row) => Math.max(max, String(row[column] ?? '').length),
      header.length,
    );
    return Math.min(Math.max(longest + 2, 10), 60);
  });
  return `<cols>${widths
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join('')}</cols>`;
}

function sheetXml(table: Table): string {
  const lastColumn = columnName(table.headers.length - 1);
  const lastRow = table.rows.length + 1;

  const rows = [table.headers, ...table.rows]
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, column) => cellXml(`${columnName(column)}${rowIndex + 1}`, value))
          .join('')}</row>`,
    )
    .join('');

  // Frozen header plus an autofilter: this file exists to be sorted and filtered.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${columnWidths(
    table,
  )}<sheetData>${rows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`;
}

const contentTypes = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from(
  { length: sheetCount },
  (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
).join('')}</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const workbookXml = (tables: Table[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tables
  .map(
    (table, i) =>
      `<sheet name="${xmlEscape(table.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
  )
  .join('')}</sheets></workbook>`;

const workbookRels = (tables: Table[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('')}</Relationships>`;

/** Any set of tables as a workbook, one sheet each. */
export function buildXlsx(tables: Table[]): Uint8Array {
  const encoder = new TextEncoder();

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes(tables.length)) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(tables)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels(tables)) },
    ...tables.map((table, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheetXml(table)),
    })),
  ];

  return zipStore(entries);
}

export function toXlsx(sessions: Session[]): Uint8Array {
  return buildXlsx([stepsTable(sessions), issuesTable(sessions)]);
}

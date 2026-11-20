import { MAX_SHEET_ROWS } from './sheet-stage';

/** Beyond this a workbook is slower to unzip and lay out than to download. */
export const MAX_XLSX_BYTES = 20 * 1024 * 1024;
const MAX_COLUMNS = 200;

export interface WorkbookSheet {
  name: string;
  /** At most MAX_SHEET_ROWS rows, every one padded to the same width. */
  rows: string[][];
  /** Rows up to the last one holding a value, including those not kept. */
  total: number;
}

/** OOXML workbooks only: legacy .xls and .ods are different formats entirely. */
export function isXlsx(contentType: string, filename: string): boolean {
  return /\.xls[xm]$/i.test(filename) || contentType.includes('spreadsheetml');
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function byTag(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', name));
}

function child(node: Element, name: string): Element | undefined {
  return Array.from(node.children).find(el => el.localName === name);
}

/** Text of a shared or inline rich string, without the phonetic guide runs. */
function richText(node: Element): string {
  return byTag(node, 't').filter(t => t.parentElement?.localName !== 'rPh').map(t => t.textContent ?? '').join('');
}

function columnIndex(ref: string): number {
  let index = 0;
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + code - 64;
  }
  return index - 1;
}

function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

/** Style indexes whose number format shows a date or time. */
function dateStyles(styles: Document | null): Set<number> {
  const result = new Set<number>();
  if (!styles) return result;
  const custom = new Map(byTag(styles, 'numFmt').map(fmt => [Number(fmt.getAttribute('numFmtId')), fmt.getAttribute('formatCode') ?? '']));
  const xfs = byTag(styles, 'cellXfs')[0];
  if (!xfs) return result;
  Array.from(xfs.children).filter(el => el.localName === 'xf').forEach((xf, index) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) result.add(index);
  });
  return result;
}

export function formatSerialDate(serial: number, date1904: boolean): string {
  const iso = new Date(Math.round(((date1904 ? serial + 1462 : serial) - 25569) * 86400000)).toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:00$/, '');
  if (serial < 1) return time;
  return Number.isInteger(serial) ? date : `${date} ${time}`;
}

function cellText(cell: Element, strings: string[], dates: Set<number>, date1904: boolean): string {
  const type = cell.getAttribute('t');
  if (type === 'inlineStr') {
    const inline = child(cell, 'is');
    return inline ? richText(inline) : '';
  }
  const value = child(cell, 'v')?.textContent ?? '';
  if (value === '') return '';
  switch (type) {
    case 's': return strings[Number(value)] ?? '';
    case 'b': return value === '1' ? 'TRUE' : 'FALSE';
    case 'str':
    case 'e':
    case 'd': return value;
    default: {
      const number = Number(value);
      if (!Number.isFinite(number)) return value;
      if (dates.has(Number(cell.getAttribute('s') ?? 0))) return formatSerialDate(number, date1904);
      // Undo binary float noise such as 0.30000000000000004.
      return String(Number(number.toPrecision(15)));
    }
  }
}

function sheetRows(sheet: Document, strings: string[], dates: Set<number>, date1904: boolean): Omit<WorkbookSheet, 'name'> {
  const kept: string[][] = [];
  let lastRow = -1;
  let width = 0;
  let nextRow = 0;
  for (const rowEl of byTag(sheet, 'row')) {
    const declared = Number(rowEl.getAttribute('r'));
    const rowIndex = declared > 0 ? declared - 1 : nextRow;
    nextRow = rowIndex + 1;
    const row: string[] = [];
    let nextColumn = 0;
    for (const cell of Array.from(rowEl.children).filter(el => el.localName === 'c')) {
      const ref = cell.getAttribute('r');
      const column = ref ? columnIndex(ref) : nextColumn;
      nextColumn = column + 1;
      if (column >= MAX_COLUMNS) continue;
      const text = cellText(cell, strings, dates, date1904);
      if (text !== '') row[column] = text;
    }
    if (row.length === 0) continue;
    lastRow = rowIndex;
    if (rowIndex < MAX_SHEET_ROWS) {
      kept[rowIndex] = row;
      width = Math.max(width, row.length);
    }
  }
  const rows = Array.from({ length: Math.min(lastRow + 1, MAX_SHEET_ROWS) }, (_, r) =>
    Array.from({ length: width }, (_, c) => kept[r]?.[c] ?? ''));
  return { rows, total: lastRow + 1 };
}

/** The visible sheets of an .xlsx/.xlsm workbook as plain text grids. */
export async function parseXlsx(data: ArrayBuffer): Promise<WorkbookSheet[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  const parser = new DOMParser();
  const read = async (path: string) => {
    const entry = zip.file(path);
    return entry ? parser.parseFromString(await entry.async('string'), 'application/xml') : null;
  };

  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('Not an Excel workbook');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const targets = new Map(rels ? byTag(rels, 'Relationship').map(rel => [rel.getAttribute('Id'), rel.getAttribute('Target') ?? '']) : []);
  const shared = await read('xl/sharedStrings.xml');
  const strings = shared ? byTag(shared, 'si').map(richText) : [];
  const dates = dateStyles(await read('xl/styles.xml'));
  const date1904 = ['1', 'true'].includes(byTag(workbook, 'workbookPr')[0]?.getAttribute('date1904') ?? '');

  const sheets: WorkbookSheet[] = [];
  for (const sheet of byTag(workbook, 'sheet')) {
    const state = sheet.getAttribute('state');
    if (state === 'hidden' || state === 'veryHidden') continue;
    const target = targets.get(sheet.getAttributeNS(REL_NS, 'id') ?? sheet.getAttribute('r:id'));
    if (!target) continue;
    const doc = await read(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    if (!doc) continue;
    sheets.push({ name: sheet.getAttribute('name') ?? '', ...sheetRows(doc, strings, dates, date1904) });
  }
  return sheets;
}

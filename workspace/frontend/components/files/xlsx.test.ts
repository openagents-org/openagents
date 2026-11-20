// @vitest-environment jsdom
import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { formatSerialDate, isXlsx, parseXlsx } from './xlsx';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function workbook(sheets: Record<string, string>, extra: Record<string, string> = {}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const names = Object.keys(sheets);
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names
    .map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"${name.startsWith('Hidden') ? ' state="hidden"' : ''}/>`)
    .join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
    .map((_, i) => `<Relationship Id="rId${i + 1}" Target="${i === 0 ? '/xl/' : ''}worksheets/sheet${i + 1}.xml"/>`)
    .join('')}</Relationships>`);
  names.forEach((name, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><sheetData>${sheets[name]}</sheetData></worksheet>`));
  for (const [path, body] of Object.entries(extra)) zip.file(path, body);
  return zip.generateAsync({ type: 'arraybuffer' });
}

it('recognises OOXML workbooks only', () => {
  expect(isXlsx('', 'report.xlsx')).toBe(true);
  expect(isXlsx('', 'macros.XLSM')).toBe(true);
  expect(isXlsx('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'download')).toBe(true);
  expect(isXlsx('application/vnd.ms-excel', 'legacy.xls')).toBe(false);
});

it('reads shared, rich, inline, boolean, date and numeric cells into a padded grid', async () => {
  const data = await workbook(
    {
      Contacts: [
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Joined</t></is></c></row>',
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0.30000000000000004</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" s="1"><v>46339</v></c></row>',
        '<row r="4" spans="1:4"><c r="B4" t="str"><v>formula text</v></c></row>',
        '<row r="9"><c r="A9" s="1"/></row>',
      ].join(''),
      Hidden: '<row r="1"><c r="A1"><v>1</v></c></row>',
      Notes: '<row r="1"><c r="A1" t="inlineStr"><is><t>only</t></is></c></row>',
    },
    {
      'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="${MAIN}"><si><t>Name</t></si><si><t>Score</t></si><si><r><t>Ali</t></r><r><t>ce</t></r><rPh><t>アリス</t></rPh></si></sst>`,
      'xl/styles.xml': `<?xml version="1.0"?><styleSheet xmlns="${MAIN}"><numFmts><numFmt numFmtId="164" formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
    },
  );

  const sheets = await parseXlsx(data);
  expect(sheets.map(s => s.name)).toEqual(['Contacts', 'Notes']);
  expect(sheets[0]).toEqual({
    name: 'Contacts',
    rows: [
      ['Name', 'Score', '', 'Joined'],
      ['Alice', '0.3', 'TRUE', '2026-11-13'],
      ['', '', '', ''],
      ['', 'formula text', '', ''],
    ],
    total: 4,
  });
  expect(sheets[1].rows).toEqual([['only']]);
});

it('rejects files that are not workbooks', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<document/>');
  await expect(parseXlsx(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow();
});

it('formats date serials as dates, date-times and times', () => {
  expect(formatSerialDate(46339, false)).toBe('2026-11-13');
  expect(formatSerialDate(46339.5, false)).toBe('2026-11-13 12:00');
  expect(formatSerialDate(0.75, false)).toBe('18:00');
  expect(formatSerialDate(44877, true)).toBe('2026-11-13');
});

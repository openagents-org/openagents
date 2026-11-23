'use client';

import { useMemo } from 'react';
import { useT } from '@/lib/i18n';

export const MAX_SHEET_ROWS = 500;

/** CSV/TSV are the only spreadsheets we can render without a parser library. */
export function delimiterFor(contentType: string, filename: string): string | null {
  if (/\.tsv$/i.test(filename) || contentType === 'text/tab-separated-values') return '\t';
  if (/\.csv$/i.test(filename) || contentType === 'text/csv') return ',';
  return null;
}

/** RFC 4180-ish: quoted cells, doubled quotes, embedded newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** CSV/TSV as a real table. */
export function SheetStage({ content, delimiter }: { content: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimited(content, delimiter), [content, delimiter]);
  return <SheetTable rows={rows.slice(0, MAX_SHEET_ROWS)} total={rows.length} />;
}

/** A grid of cells — the first row reads as a header, because in practice it
 *  always is one, and a sticky one at that. `total` counts the rows left out. */
export function SheetTable({ rows, total }: { rows: string[][]; total: number }) {
  const t = useT();
  const width = useMemo(() => rows.reduce((max, row) => Math.max(max, row.length), 0), [rows]);

  if (rows.length === 0 || width === 0) {
    return <p className="p-6 text-sm text-muted-foreground">{t('files.fileEmpty')}</p>;
  }

  const [header, ...body] = rows;
  const columns = Array.from({ length: width }, (_, c) => c);

  return (
    <div className="p-4">
      <div className="w-fit min-w-full overflow-clip rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted/70 backdrop-blur">
            <tr>
              <th className="w-10 border-b px-2 py-1.5 text-right font-normal text-muted-foreground/60 tabular-nums" />
              {columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-l px-2.5 py-1.5 text-left font-semibold whitespace-nowrap"
                >
                  {header[c] || ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="hover:bg-muted/40">
                <td className="border-b border-border/60 px-2 py-1.5 text-right text-muted-foreground/50 tabular-nums select-none">
                  {r + 1}
                </td>
                {columns.map((c) => (
                  <td
                    key={c}
                    className="max-w-70 truncate border-b border-l border-border/60 px-2.5 py-1.5"
                    title={row[c] || ''}
                  >
                    {row[c] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && (
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          {t('files.rowsTruncated', { shown: rows.length, total })}
        </p>
      )}
    </div>
  );
}

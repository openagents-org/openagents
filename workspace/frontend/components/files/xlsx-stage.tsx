'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SheetTable } from './sheet-stage';
import { MAX_XLSX_BYTES, parseXlsx, type WorkbookSheet } from './xlsx';

/** A workbook's sheets, one at a time, switched from a strip along the bottom
 *  the way spreadsheet apps do it. */
export function WorkbookView({ sheets }: { sheets: WorkbookSheet[] }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[active] ?? sheets[0];
  if (!sheet) return <SheetTable rows={[]} total={0} />;
  return (
    <Tabs value={String(active)} onValueChange={value => setActive(Number(value))} className="min-h-full gap-0">
      <div className="flex-1"><SheetTable rows={sheet.rows} total={sheet.total} /></div>
      {sheets.length > 1 && (
        <div className="sticky bottom-0 left-0 overflow-x-auto border-t bg-background px-3 py-1.5">
          <TabsList variant="line">
            {sheets.map((s, i) => <TabsTrigger key={i} value={String(i)} className="max-w-48 truncate text-xs">{s.name}</TabsTrigger>)}
          </TabsList>
        </div>
      )}
    </Tabs>
  );
}

export function XlsxStage({ fileId, size, onDownload }: { fileId: string; size: number; onDownload?: () => void }) {
  const t = useT();
  const [sheets, setSheets] = useState<WorkbookSheet[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setSheets(null); setFailed(false);
    if (size > MAX_XLSX_BYTES) { setFailed(true); return; }
    void (async () => {
      const response = await workspaceApi.fetchFile(fileId, abort.signal);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = await parseXlsx(await response.arrayBuffer());
      if (!abort.signal.aborted) setSheets(parsed);
    })().catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [fileId, size]);
  if (failed) return (
    <Empty className="h-full">
      <EmptyHeader><EmptyDescription>{t('files.loadFailed')}</EmptyDescription></EmptyHeader>
      {onDownload && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onDownload}><Download data-icon="inline-start" />{t('files.downloadFile')}</Button>
        </EmptyContent>
      )}
    </Empty>
  );
  if (!sheets) return <div className="flex h-full items-center justify-center"><Spinner className="size-6 text-muted-foreground" /></div>;
  return <WorkbookView sheets={sheets} />;
}

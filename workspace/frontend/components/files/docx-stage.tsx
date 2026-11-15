'use client';

import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';

// An opaque sandbox and CSP keep document links, scripts and remote resources
// away from the app's credentials. Embedded images remain local data URLs.
export function docxDocument(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script,iframe,object,embed,form,link,meta,base,style').forEach(node => node.remove());
  parsed.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      if (attr.name.startsWith('on') || ['style', 'srcdoc', 'srcset', 'href'].includes(attr.name)
          || (attr.name === 'src' && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(attr.value))) node.removeAttribute(attr.name);
    }
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:0;padding:28px;background:#fff;color:#171717;font:15px/1.65 system-ui;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ddd;padding:8px}h1,h2,h3{line-height:1.25}p{margin:0 0 1em}</style></head><body>${parsed.body.innerHTML}</body></html>`;
}

export function DocxStage({ fileId, filename, size, onDownload }: { fileId: string; filename: string; size: number; onDownload: () => void }) {
  const t = useT();
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setHtml(null); setFailed(false);
    if (size > 20 * 1024 * 1024) { setFailed(true); return; }
    void (async () => {
      const [response, mammoth] = await Promise.all([workspaceApi.fetchFile(fileId, abort.signal), import('mammoth')]);
      const result = await mammoth.convertToHtml({ arrayBuffer: await response.arrayBuffer() }, { externalFileAccess: false });
      if (!abort.signal.aborted) setHtml(docxDocument(result.value));
    })().catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [fileId, size]);
  if (failed) return (
    <Empty className="h-full">
      <EmptyHeader><EmptyDescription>{t('files.loadFailed')}</EmptyDescription></EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onDownload}><Download data-icon="inline-start" />{t('files.downloadFile')}</Button>
      </EmptyContent>
    </Empty>
  );
  if (!html) return <div className="flex h-full items-center justify-center"><Spinner className="size-6 text-muted-foreground" /></div>;
  return <iframe title={filename} sandbox="" referrerPolicy="no-referrer" srcDoc={html} className="h-full w-full border-0 bg-white" />;
}

"use client";
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { DropdownMenuGroup, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { toast } from 'sonner';
import type { KnowledgeEntry } from '@/lib/types';

export function KnowledgeExport({ entry }: { entry: KnowledgeEntry }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const run = async (format: 'md' | 'txt' | 'html' | 'pdf') => {
    if (busy) return;
    setBusy(true);
    try {
      const full = await workspaceApi.getKnowledgeEntry(entry.id);
      const { buildKnowledgeExport } = await import('@/lib/knowledge-export');
      const result = buildKnowledgeExport(full, format === 'pdf' ? 'html' : format);
      if (format === 'pdf') {
        const frame = document.createElement('iframe');
        frame.title = t('knowledge.exportPrint');
        frame.style.cssText = 'position:fixed;width:1px;height:1px;bottom:0;left:0;border:0;';
        frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
        frame.onload = () => {
          const win = frame.contentWindow;
          if (!win) { frame.remove(); return; }
          win.addEventListener('afterprint', () => frame.remove(), { once: true });
          win.focus(); win.print();
          // Also clean up when a browser does not fire afterprint on cancellation.
          setTimeout(() => frame.remove(), 60000);
        };
        frame.srcdoc = result.content;
        document.body.append(frame);
      } else {
        const url = URL.createObjectURL(new Blob([result.content], { type: result.mime }));
        const link = document.createElement('a');
        link.href = url; link.download = result.filename; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch { toast.error(t('knowledge.exportFailed')); }
    finally { setBusy(false); }
  };
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" disabled={busy} aria-label={t('knowledge.export')} title={t('knowledge.export')}>
    {busy ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}<span className="hidden sm:inline">{t('knowledge.export')}</span>
  </Button></DropdownMenuTrigger><DropdownMenuContent align="end">
    <DropdownMenuGroup><DropdownMenuItem onSelect={() => void run('md')}>Markdown (.md)</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => void run('txt')}>{t('knowledge.exportText')} (.txt)</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => void run('html')}>HTML (.html)</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => void run('pdf')}>{t('knowledge.exportPrint')}</DropdownMenuItem></DropdownMenuGroup>
  </DropdownMenuContent></DropdownMenu>;
}

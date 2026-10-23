'use client';
import { useRef, useState } from 'react';
import { FolderUp, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { encodeProjectFiles, projectFiles } from '@/lib/web-projects';
import { openArtifactPreview } from '@/lib/thread-artifacts';
import { useT } from '@/lib/i18n';

export function ProjectUpload({ projectId, revision, onPublished }: {projectId?: string; revision?: string; onPublished?: () => void}) {
  const t = useT();
  const {currentSessionId, refreshFiles} = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [files,setFiles] = useState<ReturnType<typeof projectFiles>>([]);
  const [title,setTitle] = useState(''); const [entry,setEntry] = useState('index.html');
  const [busy,setBusy] = useState(false);
  const publish = async () => {
    setBusy(true);
    try {
      const encoded = await encodeProjectFiles(files);
      const channel = currentSessionId && !currentSessionId.startsWith('dm:') ? currentSessionId : undefined;
      const result = await workspaceApi.publishWebProject({title,entrypoint:entry,files:encoded,channel_name:channel,visibility:channel?'inherit':'private',expected_revision:revision},projectId);
      await refreshFiles(); setFiles([]); onPublished?.(); openArtifactPreview({kind:'file',id:result.id});
      toast.success(t('webProject.published'));
    } catch(error) { toast.error(error instanceof Error ? error.message : t('artifactPanel.failed')); }
    finally {setBusy(false);}
  };
  return <div>
    <input ref={input} type="file" multiple {...{'webkitdirectory':''}} className="hidden" aria-label={t('webProject.choose')} onChange={event=>{
      const selected=projectFiles(Array.from(event.target.files || [])); setFiles(selected);
      setTitle(event.target.files?.[0]?.webkitRelativePath.split('/')[0] || 'Web project');
      setEntry(selected.find(f=>f.path==='index.html')?.path || selected.find(f=>/\.html?$/i.test(f.path))?.path || '');
      event.target.value='';
    }} />
    {!files.length ? <Button size="sm" variant="outline" onClick={()=>input.current?.click()}><FolderUp className="size-4" />{t(projectId?'webProject.update':'webProject.upload')}</Button> : <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between"><strong className="text-sm">{t(projectId?'webProject.update':'webProject.upload')}</strong><Button size="sm" mode="icon" variant="ghost" disabled={busy} aria-label={t('artifactPanel.close')} onClick={()=>setFiles([])}><X className="size-4" /></Button></div>
      <label className="block space-y-1 text-xs">{t('webProject.name')}<Input value={title} maxLength={120} disabled={busy} onChange={e=>setTitle(e.target.value)} /></label>
      <label className="block space-y-1 text-xs">{t('webProject.entry')}<select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={entry} disabled={busy} onChange={e=>setEntry(e.target.value)}>{files.filter(f=>/\.html?$/i.test(f.path)).map(f=><option key={f.path}>{f.path}</option>)}</select></label>
      <p className="text-xs leading-5 text-muted-foreground">{files.length} {t('webProject.files')} · {t(projectId?'webProject.keepsSharing':currentSessionId&&!currentSessionId.startsWith('dm:')?'webProject.threadSharing':'webProject.private')}</p>
      <p className="text-xs leading-5 text-muted-foreground">{t('webProject.help')}</p>
      {!entry && <p role="alert" className="text-xs text-destructive">{t('webProject.noHtml')}</p>}
      <Button size="sm" disabled={busy || !entry || !title.trim()} onClick={()=>void publish()}>{busy&&<Loader2 className="size-4 animate-spin" />}{t('webProject.publish')}</Button>
    </div>}
  </div>;
}

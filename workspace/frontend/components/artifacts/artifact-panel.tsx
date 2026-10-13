'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileCode2, FileText, Folder, Globe, PanelRight, Pin, PinOff, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ARTIFACT_PIN_EVENT, openArtifactPreview, isDocumentFile, sameArtifact, type ArtifactReference, type ThreadArtifactSetting } from '@/lib/thread-artifacts';
import { WEB_PROJECT_TYPE, projectDisplayName } from '@/lib/web-projects';
import { ProjectUpload } from './project-upload';
import { ArtifactContent } from './artifact-content';

type Entry = { ref: ArtifactReference; title: string; kind: 'document' | 'html' | 'browser' | 'project'; here: boolean; detail?: string };
export function ArtifactPanel() {
  const t = useT();
  const { files, knowledge, browserTabs, currentSessionId, refreshFiles, refreshKnowledge, refreshBrowserTabs } = useWorkspace();
  const { selectedArtifact, setSelectedArtifact, setShowBrowserPreview } = useLayout();
  const [setting, setSetting] = useState<ThreadArtifactSetting | null>(null);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setSetting(null);
    if (currentSessionId && !currentSessionId.startsWith('dm:')) void workspaceApi.getThreadArtifact(currentSessionId).then(data => { if (active) setSetting(data); }).catch(() => {});
    return () => { active = false; };
  }, [currentSessionId]);
  const entries = useMemo<Entry[]>(() => [
    ...files.filter(isDocumentFile).map(file => ({ ref: {kind:'file' as const,id:file.id}, title:projectDisplayName(file.filename,file.contentType), kind: (file.contentType === WEB_PROJECT_TYPE ? 'project' : /html/.test(file.contentType) || /\.html?$/i.test(file.filename) ? 'html' : 'document') as Entry['kind'], here:file.channelName === currentSessionId })),
    ...knowledge.map(entry => ({ref:{kind:'knowledge' as const,id:entry.id},title:entry.title,kind:'document' as const,here:false,detail:entry.path})),
    ...browserTabs.map(tab => ({ref:{kind:'browser' as const,id:tab.id},title:tab.title || tab.url,kind:'browser' as const,here:true,detail:tab.activity ? `${tab.activity.actor.replace(/^(openagents:|human:)/,'')} · ${tab.url}` : tab.url})),
  ], [files, knowledge, browserTabs, currentSessionId]);
  const selected = entries.find(entry => sameArtifact(entry.ref,selectedArtifact));
  const pinned = sameArtifact(setting?.artifact || null, selectedArtifact);
  const filtered = entries.filter(entry => (all || query || entry.here || sameArtifact(entry.ref,setting?.artifact || null)) && `${entry.title} ${entry.detail || ''}`.toLowerCase().includes(query.toLowerCase()));
  const pin = async (artifact: ArtifactReference | null) => {
    if (!currentSessionId || busy) return;
    setBusy(true);
    try {
      setSetting(await workspaceApi.pinThreadArtifact(currentSessionId,artifact));
      window.dispatchEvent(new CustomEvent(ARTIFACT_PIN_EVENT,{detail:currentSessionId}));
      toast.success(t(artifact ? 'artifactPanel.pinnedNotice' : 'artifactPanel.unpinnedNotice'));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('artifactPanel.failed')); }
    finally { setBusy(false); }
  };
  const refresh = async () => { setRevision(value=>value+1); await Promise.allSettled([refreshFiles(),refreshKnowledge(),refreshBrowserTabs()]); };
  return <aside data-artifact-preview className="flex h-full min-h-0 flex-col bg-background" aria-label={t('artifactPanel.title')}>
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-3">
      {selectedArtifact ? <Button variant="ghost" mode="icon" size="sm" aria-label={t('artifactPanel.browse')} onClick={()=>setSelectedArtifact(null)}><ArrowLeft className="size-4" /></Button> : <PanelRight className="size-4 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={selected?.title}>{selected?.title || t('artifactPanel.title')}</span>
      {setting?.can_pin && (selectedArtifact || setting.unavailable) && <Button variant={pinned?'outline':'ghost'} mode="icon" size="sm" disabled={busy} title={t(pinned || (!selectedArtifact && setting.unavailable) ? 'artifactPanel.unpin' : 'artifactPanel.pin')} aria-label={t(pinned || (!selectedArtifact && setting.unavailable) ? 'artifactPanel.unpin' : 'artifactPanel.pin')} onClick={()=>void pin(pinned || !selectedArtifact ? null : selectedArtifact)}>{pinned?<PinOff className="size-4" />:<Pin className="size-4" />}</Button>}
      <Button variant="ghost" mode="icon" size="sm" aria-label={t('artifactPanel.refresh')} onClick={()=>void refresh()}><RefreshCw className="size-3.5" /></Button>
      <Button variant="ghost" mode="icon" size="sm" aria-label={t('artifactPanel.close')} onClick={()=>setShowBrowserPreview(false)}><X className="size-4" /></Button>
    </header>
    {pinned && <div className="flex items-center gap-1.5 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground"><Pin className="size-3" />{t('artifactPanel.pinnedHint')}</div>}
    {selectedArtifact ? <div className="min-h-0 flex-1"><ArtifactContent artifact={selectedArtifact} revision={revision} /></div> : <div className="min-h-0 flex-1 overflow-auto p-4">
      {setting?.unavailable && <p className="mb-4 rounded-md border p-3 text-xs text-muted-foreground">{t('artifactPanel.unavailable')}</p>}
      <p className="mb-4 text-sm text-muted-foreground">{t('artifactPanel.intro')}</p>
      <div className="mb-4"><ProjectUpload /></div>
      <div className="relative mb-3"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('artifactPanel.search')} aria-label={t('artifactPanel.search')} className="pl-9" /></div>
      <div className="mb-4 flex gap-1">{[false,true].map(value=><Button key={String(value)} variant={all===value?'secondary':'ghost'} size="sm" onClick={()=>setAll(value)}>{t(value?'artifactPanel.workspace':'artifactPanel.thread')}</Button>)}</div>
      {(['project','document','html','browser'] as const).map(kind=>{
        const rows=filtered.filter(entry=>entry.kind===kind); if (!rows.length) return null;
        const Icon=kind==='document'?FileText:kind==='project'?Folder:kind==='html'?FileCode2:Globe;
        return <section key={kind} className="mb-5"><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`artifactPanel.${kind}`)}</h3>{rows.map(entry=><button key={`${entry.ref.kind}:${entry.ref.id}`} type="button" className="mb-1 flex w-full items-start gap-3 rounded-lg border border-transparent p-3 text-left hover:border-border hover:bg-muted/50" onClick={()=>openArtifactPreview(entry.ref)}><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.title}</span>{entry.detail&&<span className="mt-1 block truncate text-xs text-muted-foreground">{entry.detail}</span>}</span>{sameArtifact(entry.ref,setting?.artifact||null)&&<Pin className="mt-1 size-3.5 shrink-0 text-primary" />}</button>)}</section>;
      })}
      {!filtered.length && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('artifactPanel.empty')}</div>}
      {setting?.can_pin && <p className="mt-6 text-xs leading-5 text-muted-foreground">{t('artifactPanel.ownerHint')}</p>}
    </div>}
  </aside>;
}

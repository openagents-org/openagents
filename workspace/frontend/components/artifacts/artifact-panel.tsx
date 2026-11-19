'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, PanelRight, Pin, PinOff, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ARTIFACT_PIN_EVENT, isDocumentFile, sameArtifact, type ArtifactReference, type ThreadArtifactSetting } from '@/lib/thread-artifacts';
import { WEB_PROJECT_TYPE, projectDisplayName } from '@/lib/web-projects';
import { ProjectUpload } from './project-upload';
import { ArtifactContent } from './artifact-content';
import { ArtifactFileActions } from './artifact-file-actions';
import { ArtifactShareButton, type ShareableArtifact } from './artifact-share-button';
import { basename } from '@/components/files/file-utils';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { ArtifactBrowseList, type ArtifactEntry } from './artifact-browse-list';

type Entry = ArtifactEntry;
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
    ...files.filter(isDocumentFile).map(file => ({ ref: {kind:'file' as const,id:file.id}, title:projectDisplayName(basename(file.filename),file.contentType), detail:file.filename.includes('/') ? file.filename.slice(0,file.filename.lastIndexOf('/')) : undefined, kind: (file.contentType === WEB_PROJECT_TYPE ? 'project' : /html/.test(file.contentType) || /\.html?$/i.test(file.filename) ? 'html' : 'document') as Entry['kind'], here:file.channelName === currentSessionId })),
    ...knowledge.map(entry => ({ref:{kind:'knowledge' as const,id:entry.id},title:entry.title,kind:'document' as const,here:false,detail:entry.path})),
    ...browserTabs.map(tab => ({ref:{kind:'browser' as const,id:tab.id},title:tab.title || tab.url,kind:'browser' as const,here:!!tab.artifactChannels?.includes(currentSessionId || ''),detail:tab.activity ? `${tab.activity.actor.replace(/^(openagents:|human:)/,'')} · ${tab.url}` : tab.url})),
  ], [files, knowledge, browserTabs, currentSessionId]);
  const selected = entries.find(entry => sameArtifact(entry.ref,selectedArtifact));
  // What the Share button offers: the thread's files and documents (and the
  // pinned one). Browser tabs have no link outside the workspace.
  const shareable = useMemo<ShareableArtifact[]>(() => entries
    .filter(entry => entry.ref.kind !== 'browser' && (entry.here || sameArtifact(entry.ref,setting?.artifact || null)))
    .map(entry => ({ ref: entry.ref as ShareableArtifact['ref'], title: entry.title })), [entries, setting]);
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
      {selectedArtifact ? <Button variant="ghost" size="icon-sm" aria-label={t('artifactPanel.browse')} onClick={()=>setSelectedArtifact(null)}><ArrowLeft className="size-4" /></Button> : <PanelRight className="size-4 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={selected?.title}>{selected?.title || t('artifactPanel.title')}</span>
      {setting?.can_pin && (selectedArtifact || setting.unavailable) && <WithTooltip label={t(pinned || (!selectedArtifact && setting.unavailable) ? 'artifactPanel.unpin' : 'artifactPanel.pin')}><Button variant={pinned?'outline':'ghost'} size="icon-sm" disabled={busy} aria-label={t(pinned || (!selectedArtifact && setting.unavailable) ? 'artifactPanel.unpin' : 'artifactPanel.pin')} onClick={()=>void pin(pinned || !selectedArtifact ? null : selectedArtifact)}>{pinned?<PinOff className="size-4" />:<Pin className="size-4" />}</Button></WithTooltip>}
      {selectedArtifact && <ArtifactFileActions artifact={selectedArtifact} />}
      <Button variant="ghost" size="icon-sm" aria-label={t('artifactPanel.refresh')} onClick={()=>void refresh()}><RefreshCw className="size-3.5" /></Button>
      <ArtifactShareButton choices={shareable} selected={selectedArtifact} />
      <Button variant="ghost" size="icon-sm" aria-label={t('artifactPanel.close')} onClick={()=>setShowBrowserPreview(false)}><X className="size-4" /></Button>
    </header>
    {pinned && <div className="flex items-center gap-1.5 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground"><Pin className="size-3" />{t('artifactPanel.pinnedHint')}</div>}
    {selectedArtifact ? <div className="min-h-0 flex-1"><ArtifactContent artifact={selectedArtifact} revision={revision} /></div> : <div className="min-h-0 flex-1 overflow-auto p-4">
      {setting?.unavailable && <p className="mb-4 rounded-md border p-3 text-xs text-muted-foreground">{t('artifactPanel.unavailable')}</p>}
      <p className="mb-4 text-sm text-muted-foreground">{t('artifactPanel.intro')}</p>
      <div className="mb-4"><ProjectUpload /></div>
      <ArtifactBrowseList entries={filtered} pinned={setting?.artifact || null} query={query} onQueryChange={setQuery} all={all} onAllChange={setAll} />
      {setting?.can_pin && <p className="mt-6 text-xs leading-5 text-muted-foreground">{t('artifactPanel.ownerHint')}</p>}
    </div>}
  </aside>;
}

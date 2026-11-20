'use client';
/**
 * The Share button at the top right of the artifact panel. Pick what to
 * share — the open artifact, or any file or document of the thread — then
 * copy its workspace link for members, or publish a public link to a
 * snapshot of it, optionally expiring (PublicLinkSection). "Manage access"
 * opens the full people / visibility dialog.
 */
import { useEffect, useState } from 'react';
import { Link, Share2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SelectGroup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArtifactShareDialog, isWebPage } from '@/components/sharing/artifact-share';
import { PublicLinkSection, prefetchPublicShare } from '@/components/sharing/public-link-section';
import { basename } from '@/components/files/file-utils';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { resourcePath } from '@/lib/resource-link';
import { shareOrigin } from '@/lib/share-origin';
import { sameArtifact, type ArtifactReference } from '@/lib/thread-artifacts';
import { projectDisplayName } from '@/lib/web-projects';
import { useWorkspace } from '@/lib/workspace-context';

export type ShareableArtifact = { ref: ArtifactReference & { kind: 'file' | 'knowledge' }; title: string };

const key = (ref: ArtifactReference) => `${ref.kind}:${ref.id}`;

export function ArtifactShareButton({ choices, selected }: { choices: ShareableArtifact[]; selected: ArtifactReference | null }) {
  const t = useT();
  const { workspace, files, knowledge, refreshFiles, updateKnowledge } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const opened = selected && (selected.kind === 'file' || selected.kind === 'knowledge') ? selected : null;
  // The open artifact is always on offer, even when it isn't one of the
  // thread's own (opened from the workspace list).
  const options = opened && !choices.some(c => sameArtifact(c.ref, opened))
    ? [{ ref: opened as ShareableArtifact['ref'], title: '' }, ...choices]
    : choices;
  const [pick, setPick] = useState<string | null>(null);
  const first = opened || options[0]?.ref || null;
  // Opening the menu starts on whatever is open in the panel, set with the
  // open itself so the first frame already shows its sections.
  const openMenu = (next: boolean) => {
    if (next) setPick(first ? key(first) : null);
    setOpen(next);
  };
  // Its public link state is read ahead (the panel opening it, a hover on
  // Share), so the menu opens complete instead of on "Loading…".
  const warm = () => { if (first && first.kind !== 'browser') prefetchPublicShare(first.kind, first.id); };
  useEffect(() => { if (opened && opened.kind !== 'browser') prefetchPublicShare(opened.kind, opened.id); }, [opened?.kind, opened?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = options.find(o => key(o.ref) === pick) || null;
  const file = current?.ref.kind === 'file' ? files.find(f => f.id === current.ref.id) : undefined;
  const entry = current?.ref.kind === 'knowledge' ? knowledge.find(k => k.id === current.ref.id) : undefined;
  const name = file ? projectDisplayName(basename(file.filename), file.contentType) : entry ? entry.title : current?.title || '';
  const label = (o: ShareableArtifact) => {
    if (o.title) return o.title;
    const f = o.ref.kind === 'file' ? files.find(x => x.id === o.ref.id) : undefined;
    if (f) return projectDisplayName(basename(f.filename), f.contentType);
    return knowledge.find(x => x.id === o.ref.id)?.title || o.ref.id;
  };

  const copyWorkspaceLink = async () => {
    if (!current) return;
    try {
      const view = current.ref.kind === 'file' ? 'files' : 'knowledge';
      const url = new URL(resourcePath(workspace?.slug || workspace?.workspaceId || '', view, current.ref.id), shareOrigin());
      await navigator.clipboard.writeText(url.toString());
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('resourceLinks.copyFailed'));
    }
  };

  return <>
    <Popover open={open} onOpenChange={openMenu}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t('artifactPanel.share')} data-testid="artifact-share-button" onPointerEnter={warm} onFocus={warm}>
          <Share2 className="size-3.5" />
          <span className="hidden sm:inline">{t('artifactPanel.share')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 flex flex-col gap-4 p-3 text-sm">
        {!options.length ? <p className="text-xs text-muted-foreground">{t('artifactPanel.nothingToShare')}</p> : <>
          <section className="flex flex-col gap-1.5">
            <h4 className="text-sm font-medium">{t('artifactPanel.shareWhat')}</h4>
            <Select value={pick ?? undefined} onValueChange={setPick}>
              {/* Long file names end in "…" inside the menu's width; the full name is the tooltip. */}
              <SelectTrigger aria-label={t('artifactPanel.shareWhat')} title={current ? label(current) : undefined} className="h-9 w-full min-w-0"><SelectValue className="min-w-0" /></SelectTrigger>
              <SelectContent className="max-w-80">
                <SelectGroup>{options.map(o => <SelectItem key={key(o.ref)} value={key(o.ref)} className="*:[span]:last:min-w-0"><span className="min-w-0 truncate">{label(o)}</span></SelectItem>)}</SelectGroup>
              </SelectContent>
            </Select>
          </section>
          {current && <>
            <section className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">{t('artifactPanel.workspaceLink')}</h4>
              <p className="text-xs text-muted-foreground">{t('artifactPanel.workspaceLinkHint')}</p>
              <Button size="sm" variant="outline" className="w-full" onClick={() => void copyWorkspaceLink()}>
                <Link className="size-3.5" />{t('artifactPanel.copyWorkspaceLink')}
              </Button>
            </section>
            <PublicLinkSection key={key(current.ref)} kind={current.ref.kind} id={current.ref.id} webPage={isWebPage(file?.contentType, name)} />
            {(file || entry) && (
              <Button size="sm" variant="ghost" className="w-full text-muted-foreground" onClick={() => { setOpen(false); setManage(true); }}>
                <Users className="size-3.5" />{t('artifactPanel.manageAccess')}
              </Button>
            )}
          </>}
        </>}
      </PopoverContent>
    </Popover>
    {file && <ArtifactShareDialog
      open={manage}
      onOpenChange={setManage}
      kind="file"
      id={file.id}
      name={name}
      visibility={file.visibility}
      effectiveVisibility={file.effectiveVisibility}
      canManage={file.canManage}
      canInherit={!!file.channelName}
      contentType={file.contentType}
      onVisibilityChange={async (v) => { await workspaceApi.updateFileVisibility(file.id, v); await refreshFiles(); }}
    />}
    {entry && <ArtifactShareDialog
      open={manage}
      onOpenChange={setManage}
      kind="knowledge"
      id={entry.id}
      name={name}
      visibility={entry.visibility}
      effectiveVisibility={entry.effectiveVisibility}
      canManage={entry.canManage}
      onVisibilityChange={async (v) => { if (v) await updateKnowledge(entry.id, { visibility: v }); }}
    />}
  </>;
}

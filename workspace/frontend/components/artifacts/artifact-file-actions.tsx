'use client';
/**
 * Header actions for the artifact opened in the thread's side panel — the
 * same download / copy link the full file page offers, so a file an agent
 * produced can leave the conversation without a detour to Files. Sharing is
 * the panel's Share button (artifact-share-button.tsx).
 */
import { useEffect } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CopyResourceLink } from '@/components/sharing/copy-resource-link';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import type { ArtifactReference } from '@/lib/thread-artifacts';

export function ArtifactFileActions({ artifact }: { artifact: ArtifactReference }) {
  const t = useT();
  const { files, refreshFiles } = useWorkspace();
  const file = artifact.kind === 'file' ? files.find(f => f.id === artifact.id) : undefined;
  // A file an agent just made is opened from its message before the
  // background poll (every 30 s) lists it; ask for the list now instead, so
  // the actions don't wait on that poll.
  const missing = artifact.kind === 'file' && !file;
  useEffect(() => {
    if (missing) void refreshFiles();
  }, [missing, artifact.id, refreshFiles]);
  if (artifact.kind === 'knowledge') return <CopyResourceLink view="knowledge" id={artifact.id} />;
  if (!file) return null;
  const download = () => {
    void workspaceApi.downloadFile(file.id, file.filename).catch(error => toast.error(error instanceof Error ? error.message : t('files.loadFailed')));
  };
  return <>
    <Button variant="ghost" mode="icon" size="sm" aria-label={t('common.download')} title={t('common.download')} onClick={download}><Download className="size-4" /></Button>
    <CopyResourceLink view="files" id={file.id} />
  </>;
}

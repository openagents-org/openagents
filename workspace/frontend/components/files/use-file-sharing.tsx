'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArtifactShareDialog } from '@/components/sharing/artifact-share';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { ArtifactVisibility, WorkspaceFile } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { projectDisplayName } from '@/lib/web-projects';
import { basename } from './file-utils';

/**
 * Permission model v1.1 — the share dialog and the visibility flips a file's
 * row menu offers. The dialog's file is held by id so a refresh after a flip
 * re-derives the latest row.
 */
export function useFileSharing() {
  const { files, refreshFiles } = useWorkspace();
  const t = useT();
  const [shareFileId, setShareFileId] = useState<string | null>(null);
  const shareFile = shareFileId ? files.find((f) => f.id === shareFileId) ?? null : null;

  const setFileVisibility = async (file: WorkspaceFile, visibility: ArtifactVisibility | null) => {
    await workspaceApi.updateFileVisibility(file.id, visibility);
    await refreshFiles();
  };

  const flipVisibility = async (file: WorkspaceFile, visibility: ArtifactVisibility | null) => {
    try {
      await setFileVisibility(file, visibility);
      toast.success(t('artifactAccess.visibilityUpdated'));
    } catch {
      toast.error(t('artifactAccess.visibilityUpdateFailed'));
    }
  };

  const shareDialog = shareFile && (
    <ArtifactShareDialog
      open
      onOpenChange={(open) => { if (!open) setShareFileId(null); }}
      kind="file"
      id={shareFile.id}
      name={projectDisplayName(basename(shareFile.filename), shareFile.contentType)}
      visibility={shareFile.visibility}
      effectiveVisibility={shareFile.effectiveVisibility}
      canManage={shareFile.canManage}
      canInherit={!!shareFile.channelName}
      onVisibilityChange={(v) => setFileVisibility(shareFile, v)}
      contentType={shareFile.contentType}
    />
  );

  return { share: setShareFileId, flipVisibility, shareDialog };
}

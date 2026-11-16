'use client';

import type { ReactNode } from 'react';
import { Download, ExternalLink, PanelRight, Pencil, Save, Trash2 } from 'lucide-react';
import { AccessExplainer } from '@/components/sharing/access-explainer';
import { ArtifactOwner, ArtifactVisibilityBadge } from '@/components/sharing/artifact-access-badge';
import { ArtifactSharePopover } from '@/components/sharing/artifact-share';
import { CopyResourceLink } from '@/components/sharing/copy-resource-link';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { workspaceApi } from '@/lib/api';
import { useFormatters, useT } from '@/lib/i18n';
import type { WorkspaceFile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { projectDisplayName } from '@/lib/web-projects';
import { basename, getFileTypeMeta, type FileKind } from './file-utils';

/** An icon-only header action with its label as the tooltip. */
function IconAction({
  label,
  onClick,
  className,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
          aria-pressed={pressed}
          className={cn('text-muted-foreground', className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The open file's header actions: what it is, who can see it, editing for
 * markdown, sharing, and download/delete.
 */
export function FilePreviewActions({
  file,
  kind,
  editable,
  editing,
  saving,
  dirty,
  onEdit,
  onCancelEdit,
  onSave,
  hasInfoPanel,
  infoOpen,
  onToggleInfo,
  onOpenInNewTab,
  onDownload,
  onDelete,
}: {
  file: WorkspaceFile;
  kind: FileKind;
  /** Markdown whose text has loaded — the one kind the preview can edit. */
  editable: boolean;
  editing: boolean;
  saving: boolean;
  dirty: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  hasInfoPanel: boolean;
  infoOpen: boolean;
  onToggleInfo: () => void;
  onOpenInNewTab: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { formatFileSize } = useFormatters();
  const { refreshFiles } = useWorkspace();
  const { contentType, filename } = file;
  const infoLabel = infoOpen ? t('files.hideFileInfo') : t('files.showFileInfo');

  return (
    <>
      {/* File metadata — the single-line header keeps it beside the actions */}
      <span className="hidden max-w-105 truncate text-xs text-muted-foreground lg:inline">
        {formatFileSize(file.size)} · {t(getFileTypeMeta(contentType, filename).labelKey)} ·{' '}
        {(file.uploadedBy || 'unknown').replace(/^(openagents:|human:)/, '')}
      </span>
      {/* Permission model v1.1 — owner + visibility, then Share… */}
      {(file.owner || file.visibility) && (
        <span className="hidden items-center gap-1.5 lg:inline-flex">
          <ArtifactOwner owner={file.owner} ownerLabel={file.ownerLabel} />
          <ArtifactVisibilityBadge kind="file" visibility={file.visibility} effectiveVisibility={file.effectiveVisibility} />
          <AccessExplainer resourceKind="file" resourceId={file.id} className="max-w-56" />
        </span>
      )}
      {editable && (!editing ? (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil data-icon="inline-start" />
          {t('files.editMarkdown')}
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={onCancelEdit} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
            {saving ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {t('common.save')}
          </Button>
        </>
      ))}
      <CopyResourceLink view="files" id={file.id} />
      <ArtifactSharePopover
        kind="file"
        id={file.id}
        name={projectDisplayName(basename(filename), contentType)}
        visibility={file.visibility}
        effectiveVisibility={file.effectiveVisibility}
        canManage={file.canManage}
        canInherit={!!file.channelName}
        contentType={contentType}
        onVisibilityChange={async (v) => {
          await workspaceApi.updateFileVisibility(file.id, v);
          await refreshFiles();
        }}
      />
      {/* Only the stages that have a metadata column get the switch, and only
          at the width where that column exists — a toggle for something the
          viewport has already hidden is a button that does nothing. */}
      {hasInfoPanel && (
        <IconAction
          label={infoLabel}
          onClick={onToggleInfo}
          pressed={infoOpen}
          className={cn('hidden xl:inline-flex', infoOpen && 'text-foreground')}
        >
          <PanelRight />
        </IconAction>
      )}
      {/* Media and PDFs are worth a full window; the pane is narrow. */}
      {(kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'web') && (
        <IconAction label={t('files.openInNewTab')} onClick={onOpenInNewTab}>
          <ExternalLink />
        </IconAction>
      )}
      <IconAction label={t('common.download')} onClick={onDownload}>
        <Download />
      </IconAction>
      <IconAction label={t('common.delete')} onClick={onDelete} className="hover:text-destructive">
        <Trash2 />
      </IconAction>
    </>
  );
}

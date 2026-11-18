'use client';

import { FileX, FolderOpen, PanelLeft, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useT } from '@/lib/i18n';
import type { FileTypeFilter } from './file-utils';

/**
 * Nothing to be recent about — a workspace with no files at all. On mobile,
 * where the folder panel is a separate pane, it offers the way to reach it.
 */
export function FilesEmptyWorkspace({ onUpload, onBrowseFolders }: { onUpload: () => void; onBrowseFolders?: () => void }) {
  const t = useT();
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpen />
        </EmptyMedia>
        <EmptyTitle>{t('files.emptyTitle')}</EmptyTitle>
        <EmptyDescription className="text-balance">{t('files.emptyBody')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onUpload}>
          <Upload data-icon="inline-start" />
          {t('files.uploadFiles')}
        </Button>
        {onBrowseFolders && (
          <Button variant="outline" size="sm" onClick={onBrowseFolders}>
            <PanelLeft data-icon="inline-start" />
            {t('files.browseFolders')}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

/**
 * A listing that came up empty — the folder itself, or what narrowed it — and
 * the one move that gets out of it. Moving between folders belongs to the
 * trail in the header and the panel on the left, so it isn't offered here.
 */
export function FolderEmpty({
  typeFilter,
  filterLabel,
  search,
  folder,
  onClearFilter,
  onClearSearch,
  onUpload,
}: {
  typeFilter: FileTypeFilter;
  /** The active type filter's name, when one is a type rather than folders/all. */
  filterLabel: string | null;
  search: string;
  /** The folder on screen, or null on the recent list. */
  folder: string | null;
  onClearFilter: () => void;
  onClearSearch: () => void;
  onUpload: () => void;
}) {
  const t = useT();
  const title = typeFilter === 'folders'
    ? t('files.noFoldersHere')
    : filterLabel
      ? t('files.noTypeHere', { type: filterLabel })
      : search ? t('files.noMatches') : t('files.folderEmpty');
  const description = folder === null
    ? t('files.noMatchesHint')
    : typeFilter === 'folders'
      ? search ? t('files.noSubfolderMatches') : t('files.noSubfolders')
      : filterLabel
        ? search ? t('files.noTypeMatchesInFolder') : t('files.noTypeInFolder')
        : search
          // Says where it looked: the search covers this folder, so a miss
          // here doesn't mean the file isn't in the workspace.
          ? t('files.noMatchesIn', { folder, query: search })
          : t('files.dropHint');

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileX />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription className="text-balance">{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {typeFilter !== 'all' ? (
          <Button variant="outline" size="sm" onClick={onClearFilter}>
            <X data-icon="inline-start" />
            {t('files.clearFilter')}
          </Button>
        ) : search ? (
          <Button variant="outline" size="sm" onClick={onClearSearch}>
            <X data-icon="inline-start" />
            {t('files.clearSearch')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload data-icon="inline-start" />
            {t('files.uploadFiles')}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

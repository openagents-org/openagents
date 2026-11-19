'use client';

import { BookOpen, Pencil, Share2, Trash2 } from 'lucide-react';
import { ArtifactVisibilityBadge } from '@/components/sharing/artifact-access-badge';
import { Button } from '@/components/ui/button';
import { useFormatters, useT } from '@/lib/i18n';
import type { KnowledgeEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * One entry in the knowledge list. The row itself selects; share, edit and
 * delete float in on hover or focus (always shown on touch screens).
 */
export function KnowledgeEntryRow({
  entry,
  title,
  selected,
  onSelect,
  onShare,
  onEdit,
  onDelete,
}: {
  entry: KnowledgeEntry;
  title: string;
  selected: boolean;
  onSelect: () => void;
  onShare: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group relative mx-2 mb-1 flex shrink-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-3 transition-colors',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
        selected ? 'border-border bg-accent shadow-xs' : 'border-transparent hover:bg-muted/50',
      )}
    >
      <BookOpen className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground/60')} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 line-clamp-2 text-sm leading-snug font-medium text-foreground" title={title}>
            {title}
          </p>
          <span className="shrink-0"><ArtifactVisibilityBadge kind="knowledge" visibility={entry.visibility} effectiveVisibility={entry.effectiveVisibility} /></span>
        </div>
        {entry.description && (
          <p className="line-clamp-1 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
        )}
        <div className="mt-1 flex min-h-6 items-center gap-2 pr-20">
          <span className="truncate text-xs text-muted-foreground">{timeAgo(entry.updatedAt || entry.createdAt)}</span>
        </div>
      </div>

      <div className="pointer-events-none absolute right-2 bottom-2 flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5 text-muted-foreground opacity-0 shadow-sm transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('artifactAccess.share')}
          title={t('artifactAccess.share')}
          onClick={(e) => { e.stopPropagation(); onShare(); }}
        >
          <Share2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('knowledge.editEntry')}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('knowledge.deleteEntry')}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

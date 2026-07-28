'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import type { KnowledgeEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { KnowledgeEditor } from './knowledge-editor';
import { knowledgeTimeAgo } from './knowledge-utils';

/**
 * Knowledge entries in the shell's list panel, matching the thread list:
 * a header on the shared `--header-height` baseline, a search row, then rows.
 */
export function KnowledgeList() {
  const {
    knowledge, refreshKnowledge, deleteKnowledge,
    selectedKnowledgeId, setSelectedKnowledgeId,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();

  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<(KnowledgeEntry & { content: string }) | null>(null);

  useEffect(() => { refreshKnowledge(); }, [refreshKnowledge]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return knowledge;
    return knowledge.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q),
    );
  }, [knowledge, query]);

  const handleEdit = useCallback(async (entry: KnowledgeEntry) => {
    try {
      const full = await workspaceApi.getKnowledgeEntry(entry.id);
      setEditingEntry({ ...full });
      setEditorOpen(true);
    } catch {
      // ignore — the entry may have been removed
    }
  }, []);

  const handleDelete = useCallback(async (entry: KnowledgeEntry) => {
    await deleteKnowledge(entry.id);
    if (selectedKnowledgeId === entry.id) setSelectedKnowledgeId(null);
  }, [deleteKnowledge, selectedKnowledgeId, setSelectedKnowledgeId]);

  const openNew = () => { setEditingEntry(null); setEditorOpen(true); };

  const select = (entry: KnowledgeEntry) => {
    setSelectedKnowledgeId(entry.id);
    if (isMobile) openMobileDetail();
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm leading-relaxed font-semibold">Knowledge</span>
          {knowledge.length > 0 && (
            <Badge variant="secondary" appearance="light" size="sm" shape="circle">
              {knowledge.length}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                aria-label="Refresh knowledge"
                onClick={refreshKnowledge}
                className="text-muted-foreground"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                aria-label="New entry"
                onClick={openNew}
                className="text-muted-foreground"
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New entry</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            placeholder="Search knowledge…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search knowledge"
            className="h-7 pl-7 text-xs"
          />
          {query && (
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 size-5 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Rows */}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:flex! [&>div]:min-h-full [&>div]:flex-col">
        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
            <BookOpen className="mb-2 size-8 text-muted-foreground/25" />
            <p className="mb-3 text-xs text-muted-foreground">
              {query ? 'No entries matching your search' : 'No knowledge entries yet'}
            </p>
            {query ? (
              <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                Clear search
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={openNew}>
                <Plus className="size-3.5" />
                Create First Entry
              </Button>
            )}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              role="listitem"
              tabIndex={0}
              aria-pressed={selectedKnowledgeId === entry.id}
              onClick={() => select(entry)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(entry);
                }
              }}
              className={cn(
                'group relative flex shrink-0 cursor-pointer items-start gap-2 border-b border-border/40 px-3 py-2.5 transition-colors',
                'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
                selectedKnowledgeId === entry.id
                  ? 'bg-accent/60 dark:bg-accent/20'
                  : 'hover:bg-accent/60 dark:hover:bg-accent/20',
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-sm leading-tight font-medium text-foreground">
                  {entry.title}
                </p>
                {entry.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {entry.description}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <span className="truncate font-mono text-[10px] text-muted-foreground/60">
                    @knowledge:{entry.slug}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {knowledgeTimeAgo(entry.updatedAt || entry.createdAt)}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  aria-label="Edit entry"
                  onClick={(e) => { e.stopPropagation(); handleEdit(entry); }}
                  className="text-muted-foreground"
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  aria-label="Delete entry"
                  onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </ScrollArea>

      <KnowledgeEditor
        open={editorOpen}
        entry={editingEntry}
        onClose={() => { setEditorOpen(false); setEditingEntry(null); }}
        onSaved={async () => {
          setEditorOpen(false);
          setEditingEntry(null);
          await refreshKnowledge();
        }}
      />
    </div>
  );
}

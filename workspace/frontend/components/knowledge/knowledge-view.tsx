'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Loader2, Pencil } from 'lucide-react';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Button } from '@/components/ui/button';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { workspaceApi } from '@/lib/api';
import type { KnowledgeEntry } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { KnowledgeEditor } from './knowledge-editor';

/**
 * The knowledge detail pane. The entry list lives in the shell's list panel
 * (see knowledge-list.tsx), so this view only renders the selected entry —
 * same list/detail split as threads and files.
 */
export function KnowledgeView() {
  const { knowledge, refreshKnowledge, agents, selectedKnowledgeId } = useWorkspace();
  const { isMobile, openMobileList } = useLayout();
  const agentNames = agents.map((a) => a.agentName);

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<(KnowledgeEntry & { content: string }) | null>(null);

  const entry = knowledge.find((k) => k.id === selectedKnowledgeId) || null;

  // Load the selected entry's body. `knowledge` is in the deps so a save that
  // bumps updatedAt re-fetches the content the user is looking at.
  useEffect(() => {
    if (!selectedKnowledgeId) {
      setContent('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    workspaceApi
      .getKnowledgeEntry(selectedKnowledgeId)
      .then((full) => { if (!cancelled) setContent(full.content); })
      .catch(() => { if (!cancelled) setContent('Failed to load content.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedKnowledgeId, knowledge]);

  const handleEdit = useCallback(async () => {
    if (!entry) return;
    try {
      const full = await workspaceApi.getKnowledgeEntry(entry.id);
      setEditingEntry({ ...full });
      setEditorOpen(true);
    } catch {
      // ignore — the entry may have been removed
    }
  }, [entry]);

  if (!entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <BookOpen className="size-8 opacity-30" />
        <p className="text-sm">Select an entry to view</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <DetailHeader
        title={<>
          {isMobile && (
            <button
              type="button"
              onClick={openMobileList}
              className="p-1 -ml-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <h2 className="truncate text-sm font-semibold">{entry.title}</h2>
        </>}
      >
        <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground md:inline">
          @knowledge:{entry.slug}
        </span>
        <Button
          variant="ghost"
          mode="icon"
          size="sm"
          aria-label="Edit entry"
          onClick={handleEdit}
          className="text-muted-foreground"
        >
          <Pencil className="size-3.5" />
        </Button>
      </DetailHeader>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          /* h-full, not a fixed box: the wait belongs to the whole pane, and a
             128px one centred its spinner against the top of an empty page.
             Same spinner the file preview uses — it's the same wait. */
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownContent content={content} agentNames={agentNames} />
          </div>
        )}
      </div>

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

'use client';

import { ArrowLeft, BookOpen, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import type { KnowledgeEntry } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { KnowledgeEditor } from './knowledge-editor';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function KnowledgeView() {
  const { knowledge, refreshKnowledge, deleteKnowledge, agents } = useWorkspace();
  const { isMobile } = useLayout();
  const agentNames = agents.map((a) => a.agentName);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<(KnowledgeEntry & { content: string }) | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);

  useEffect(() => { refreshKnowledge(); }, [refreshKnowledge]);

  const selectedEntry = knowledge.find((k) => k.id === selectedId) || null;

  const handleSelect = useCallback(async (entry: KnowledgeEntry) => {
    setSelectedId(entry.id);
    setLoadingContent(true);
    setMobileDetail(true);
    try {
      const full = await workspaceApi.getKnowledgeEntry(entry.id);
      setSelectedContent(full.content);
    } catch {
      setSelectedContent('Failed to load content.');
    } finally {
      setLoadingContent(false);
    }
  }, []);

  const handleEdit = useCallback(async (entry: KnowledgeEntry) => {
    try {
      const full = await workspaceApi.getKnowledgeEntry(entry.id);
      setEditingEntry({ ...full });
      setEditorOpen(true);
    } catch {
      // ignore
    }
  }, []);

  const handleDelete = useCallback(async (entry: KnowledgeEntry) => {
    await deleteKnowledge(entry.id);
    if (selectedId === entry.id) {
      setSelectedId(null);
      setSelectedContent('');
    }
  }, [deleteKnowledge, selectedId]);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
    setEditingEntry(null);
  }, []);

  const handleEditorSaved = useCallback(async () => {
    setEditorOpen(false);
    setEditingEntry(null);
    await refreshKnowledge();
    if (selectedId) {
      try {
        const full = await workspaceApi.getKnowledgeEntry(selectedId);
        setSelectedContent(full.content);
      } catch { /* ignore */ }
    }
  }, [refreshKnowledge, selectedId]);

  // List component
  const EntryList = (
    <div className="h-full flex flex-col">
      <div className="shrink-0 h-12 px-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Knowledge</h2>
          {knowledge.length > 0 && (
            <span className="text-xs text-muted-foreground">{knowledge.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setEditingEntry(null); setEditorOpen(true); }}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title="New entry"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={refreshKnowledge}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {knowledge.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <BookOpen className="size-8 opacity-30" />
            <p className="text-sm">No knowledge entries yet</p>
            <p className="text-xs opacity-60">Create shared knowledge for your agents</p>
            <button
              type="button"
              onClick={() => { setEditingEntry(null); setEditorOpen(true); }}
              className="mt-2 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Create First Entry
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {knowledge.map((entry) => (
              <div
                key={entry.id}
                className={`flex items-start justify-between gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group ${
                  selectedId === entry.id ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''
                }`}
              >
                <button
                  type="button"
                  aria-current={selectedId === entry.id ? 'true' : undefined}
                  onClick={() => handleSelect(entry)}
                  className="min-w-0 flex-1 px-4 py-3 text-left"
                >
                  <p className="text-sm font-medium truncate">{entry.title}</p>
                  {entry.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground/60 font-mono">@knowledge:{entry.slug}</span>
                    <span className="text-[10px] text-muted-foreground/60">{timeAgo(entry.updatedAt || entry.createdAt)}</span>
                  </div>
                </button>
                <div className="flex items-center gap-1 py-3 pr-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleEdit(entry); }}
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground"
                    title="Edit"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-500"
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <KnowledgeEditor
        open={editorOpen}
        entry={editingEntry}
        onClose={handleEditorClose}
        onSaved={handleEditorSaved}
      />
    </div>
  );

  // Detail component
  const EntryDetail = selectedEntry ? (
    <div className="h-full flex flex-col">
      <div className="shrink-0 h-12 px-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {isMobile && (
            <button type="button" onClick={() => setMobileDetail(false)} className="p-1 -ml-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <ArrowLeft className="size-4" />
            </button>
          )}
          <h2 className="text-sm font-semibold truncate">{selectedEntry.title}</h2>
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">@knowledge:{selectedEntry.slug}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleEdit(selectedEntry)}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title="Edit"
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loadingContent ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownContent content={selectedContent} agentNames={agentNames} />
          </div>
        )}
      </div>

      <KnowledgeEditor
        open={editorOpen}
        entry={editingEntry}
        onClose={handleEditorClose}
        onSaved={handleEditorSaved}
      />
    </div>
  ) : (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
      <BookOpen className="size-8 opacity-30" />
      <p className="text-sm">Select an entry to view</p>
    </div>
  );

  // Mobile: single pane switching
  if (isMobile) {
    return mobileDetail && selectedEntry ? EntryDetail : EntryList;
  }

  // Desktop: split view
  return (
    <div className="h-full flex">
      <div className="w-[300px] xl:w-[360px] shrink-0 border-r border-border overflow-hidden">
        {EntryList}
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        {EntryDetail}
      </div>
    </div>
  );
}

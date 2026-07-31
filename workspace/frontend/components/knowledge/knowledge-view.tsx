'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Copy, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Button } from '@/components/ui/button';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { workspaceApi } from '@/lib/api';
import type { KnowledgeEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { KnowledgeEditor } from './knowledge-editor';
import { knowledgeAuthorName, knowledgeTimeAgo, stripLeadingTitle } from './knowledge-utils';

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
  const [copied, setCopied] = useState(false);

  const entry = knowledge.find((k) => k.id === selectedKnowledgeId) || null;

  // A save that bumps updatedAt should re-fetch the body — but depend on that
  // timestamp, NOT on the `knowledge` array. refreshKnowledge() calls
  // setKnowledge() with a brand-new array every time, so depending on the array
  // itself threw away the rendered article and flashed a spinner on every list
  // refresh, tab switch, and delete.
  const entryVersion = entry?.updatedAt || entry?.createdAt || null;
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
  }, [selectedKnowledgeId, entryVersion]);

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

  // The mention is what this entry is *for* — it's how an agent pulls the
  // content into a thread — so it gets a copy affordance, not grey small print.
  const handleCopyMention = useCallback(async () => {
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(`@knowledge:${entry.slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
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
        {/* The slug used to live here as static grey text; it now sits in the
            article header as a copyable chip, so the toolbar keeps just Edit. */}
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

      {/* The article fills the pane rather than sitting in a centred column:
          centring bought a readable measure at the cost of a wide gutter down
          both sides. Readability is handled per-element instead — text is
          capped at ~70ch (see the body below) while code blocks and tables
          take the full width they need. */}
      <div className="flex-1 overflow-y-auto">
        <article className="w-full px-6 py-6 sm:px-8">
          <header className="max-w-[70ch]">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight text-foreground">
              {entry.title}
            </h1>
            {entry.description && (
              <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
                {entry.description}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={handleCopyMention}
                aria-label="Copy mention"
                title="Copy mention"
                className="group/mention inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] transition-colors hover:border-border hover:bg-muted hover:text-foreground"
              >
                {copied ? (
                  <Check className="size-3 text-green-600 dark:text-green-400" />
                ) : (
                  <Copy className="size-3 opacity-40 transition-opacity group-hover/mention:opacity-100" />
                )}
                @knowledge:{entry.slug}
              </button>
              {(entry.updatedAt || entry.createdAt) && (
                <>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span>Updated {knowledgeTimeAgo(entry.updatedAt || entry.createdAt)}</span>
                </>
              )}
              {knowledgeAuthorName(entry.updatedBy || entry.createdBy) && (
                <>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span>{knowledgeAuthorName(entry.updatedBy || entry.createdBy)}</span>
                </>
              )}
            </div>
          </header>

          {/* The header renders from list data that's already loaded, so only
              the body waits — the title no longer blinks in after a fetch.
              No `prose` wrapper on the body: MarkdownContent styles every
              element itself, and `prose-sm` would pin it back to 14px. */}
          <div className="mt-5 border-t border-border/60 pt-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div
                className={cn(
                  'text-[15px] leading-7',
                  // Text is held to a readable measure; code blocks, tables and
                  // diagrams (the `div` wrappers MarkdownContent emits) bleed
                  // out to the full column so long curl lines don't need a
                  // horizontal drag to read.
                  '[&_.markdown-content>*]:max-w-[70ch]',
                  '[&_.markdown-content>div]:max-w-none [&_.markdown-content>pre]:max-w-none',
                  // MarkdownContent's own scale is tuned for chat bubbles, where
                  // headings sit inside a short message. In a long reference doc
                  // an h2 at 16px against 15px body text reads as bold text, not
                  // as a section break — so the hierarchy and rhythm are opened
                  // up here rather than in the shared component.
                  '[&_.markdown-content>h1]:mt-10 [&_.markdown-content>h1]:mb-3 [&_.markdown-content>h1]:text-xl',
                  '[&_.markdown-content>h2]:mt-9 [&_.markdown-content>h2]:mb-2.5 [&_.markdown-content>h2]:text-lg',
                  '[&_.markdown-content>h3]:mt-7 [&_.markdown-content>h3]:mb-2 [&_.markdown-content>h3]:text-base',
                  '[&_.markdown-content>*:first-child]:mt-0',
                  '[&_.markdown-content>p]:mb-4 [&_.markdown-content>ul]:my-4 [&_.markdown-content>ol]:my-4',
                  '[&_.markdown-content>pre]:my-5 [&_.markdown-content>pre]:p-4',
                  '[&_.markdown-content>div]:my-5',
                )}
              >
                <MarkdownContent
                  content={stripLeadingTitle(content, entry.title)}
                  agentNames={agentNames}
                />
              </div>
            )}
          </div>
        </article>
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

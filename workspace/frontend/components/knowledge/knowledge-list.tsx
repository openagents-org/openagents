'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Folder, FolderPlus, ChevronRight, FileText, ArrowLeft, BookOpen, Pencil, Plus, RefreshCw, Search, Share2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/responsive-dialog';
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
import { useFormatters, useT } from '@/lib/i18n';
import { KnowledgeEditor } from './knowledge-editor';
import { ArtifactShareDialog } from '@/components/sharing/artifact-share';
import { ArtifactVisibilityBadge } from '@/components/sharing/artifact-access-badge';

/**
 * Knowledge entries in the shell's list panel, matching the thread list:
 * a header on the shared `--header-height` baseline, a search row, then rows.
 */
export function KnowledgeList() {
  const {
    knowledge, refreshKnowledge, deleteKnowledge,
    selectedKnowledgeId, setSelectedKnowledgeId,
    updateKnowledge,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const t = useT();
  const { timeAgo } = useFormatters();

  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);
  const loadFolders = useCallback(() => workspaceApi.listKnowledgeFolders().then(setFolders).catch(() => toast.error(t('knowledge.loadFailed'))), [t]);
  useEffect(() => { void loadFolders(); }, [loadFolders]);
  useEffect(() => {
    const selected = knowledge.find(entry => entry.id === selectedKnowledgeId);
    if (selected) setFolder(selected.folderPath || '');
  }, [selectedKnowledgeId, knowledge]);
  const childFolders = folders.filter(path => path.split('/').slice(0, -1).join('/') === folder);
  const createFolder = async () => {
    if (!folderName.trim() || folderName.includes('/')) return;
    setSavingFolder(true);
    try {
      await workspaceApi.createKnowledgeFolder([folder, folderName.trim()].filter(Boolean).join('/'));
      await loadFolders(); setNewFolderOpen(false); setFolderName('');
    } catch (error) { toast.error(error instanceof Error ? error.message : t('knowledge.loadFailed')); }
    finally { setSavingFolder(false); }
  };
  const [editorOpen, setEditorOpen] = useState(false);
  // Permission model v1.1 — share dialog, by id so a refresh re-derives the row.
  const [shareEntryId, setShareEntryId] = useState<string | null>(null);
  const shareEntry = shareEntryId ? knowledge.find((k) => k.id === shareEntryId) ?? null : null;
  const [editingEntry, setEditingEntry] = useState<(KnowledgeEntry & { content: string }) | null>(null);

  useEffect(() => { refreshKnowledge(); }, [refreshKnowledge]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return knowledge.filter(entry => (entry.folderPath || "") === folder);
    return knowledge.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q),
    );
  }, [knowledge, query, folder]);

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
          <span className="text-sm leading-relaxed font-semibold">{t('knowledge.title')}</span>
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
                aria-label={t('knowledge.refresh')}
                onClick={refreshKnowledge}
                className="text-muted-foreground"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.refresh')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                aria-label={t('knowledge.newEntry')}
                onClick={openNew}
                className="text-muted-foreground"
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('knowledge.newEntry')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 pt-3 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            placeholder={t('knowledge.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('knowledge.searchLabel')}
            className="h-8 rounded-lg bg-muted/30 pl-7 pr-7 text-xs"
          />
          {query && (
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={() => setQuery('')}
              aria-label={t('knowledge.clearSearch')}
              className="absolute top-1/2 right-1 size-5 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-muted-foreground">
        {folder && <Button variant="ghost" mode="icon" size="sm" aria-label={t('knowledge.parentFolder')} onClick={() => { setFolder(folder.split('/').slice(0,-1).join('/')); setSelectedKnowledgeId(null); setQuery(''); }}><ArrowLeft className="size-3.5" /></Button>}
        <span className="min-w-0 flex-1 truncate" title={'/' + folder}>{folder ? '/' + folder : t('knowledge.rootFolder')}</span>
        <Button variant="ghost" mode="icon" size="sm" title={t('knowledge.newFolder')} aria-label={t('knowledge.newFolder')} onClick={() => setNewFolderOpen(true)}><FolderPlus className="size-4" /></Button>
      </div>
      {/* Rows */}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:flex! [&>div]:min-h-full [&>div]:flex-col">
        {!query && childFolders.map(path => (
          <button key={path} className="mx-2 mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setFolder(path); setSelectedKnowledgeId(null); }}>
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{path.split('/').at(-1)}</span>
            <ChevronRight className="size-3.5 text-muted-foreground/60" />
          </button>
        ))}
        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
            <BookOpen className="mb-2 size-8 text-muted-foreground/25" />
            <p className="mb-3 text-xs text-muted-foreground">
              {query ? t('knowledge.emptySearch') : t('knowledge.empty')}
            </p>
            {query ? (
              <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                {t('knowledge.clearSearch')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={openNew}>
                <Plus className="size-3.5" />
                {t('knowledge.createFirst')}
              </Button>
            )}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              role="button"
              tabIndex={0}
              aria-pressed={selectedKnowledgeId === entry.id}
              onClick={() => select(entry)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(entry);
                }
              }}
              className={cn(
                'group relative mx-2 mb-1 flex shrink-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-3 transition-colors',
                'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
                selectedKnowledgeId === entry.id
                  ? 'border-border bg-accent/70 shadow-xs dark:bg-accent/40'
                  : 'border-transparent hover:bg-muted/60',
              )}
            >
              <FileText className={cn('mt-0.5 size-4 shrink-0', selectedKnowledgeId === entry.id ? 'text-foreground/80' : 'text-muted-foreground/60')} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground" title={entry.title}>
                  {entry.title}
                </p>
                {entry.description && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {entry.description}
                  </p>
                )}
                <div className="mt-2 flex min-h-6 items-center gap-2 pr-20">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {timeAgo(entry.updatedAt || entry.createdAt)}
                  </span>
                  <ArtifactVisibilityBadge kind="knowledge" visibility={entry.visibility} effectiveVisibility={entry.effectiveVisibility} />
                </div>
              </div>

              <div className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5 pointer-events-none opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                <Button
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  aria-label={t('artifactAccess.share')}
                  title={t('artifactAccess.share')}
                  onClick={(e) => { e.stopPropagation(); setShareEntryId(entry.id); }}
                  className="size-6 text-muted-foreground"
                >
                  <Share2 className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  aria-label={t('knowledge.editEntry')}
                  onClick={(e) => { e.stopPropagation(); handleEdit(entry); }}
                  className="size-6 text-muted-foreground"
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  aria-label={t('knowledge.deleteEntry')}
                  onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                  className="size-6 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </ScrollArea>

      {shareEntry && (
        <ArtifactShareDialog
          open
          onOpenChange={(open) => { if (!open) setShareEntryId(null); }}
          kind="knowledge"
          id={shareEntry.id}
          name={shareEntry.title}
          visibility={shareEntry.visibility}
          effectiveVisibility={shareEntry.effectiveVisibility}
          canManage={shareEntry.canManage}
          onVisibilityChange={async (v) => { if (v) await updateKnowledge(shareEntry.id, { visibility: v }); }}
        />
      )}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}><DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{t('knowledge.newFolder')}</DialogTitle></DialogHeader>
        <DialogBody><p className="mb-3 text-xs text-muted-foreground">{t('knowledge.folderHint')}</p><Input autoFocus value={folderName} onChange={event => setFolderName(event.target.value)} placeholder={t('knowledge.folderName')} aria-label={t('knowledge.folderName')} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!savingFolder) void createFolder(); } }} /></DialogBody>
        <DialogFooter><Button variant="outline" onClick={() => setNewFolderOpen(false)}>{t('common.cancel')}</Button><Button disabled={savingFolder || !folderName.trim() || folderName.includes('/')} onClick={() => void createFolder()}>{t('common.create')}</Button></DialogFooter>
      </DialogContent></Dialog>
      <KnowledgeEditor
        defaultFolder={folder}
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

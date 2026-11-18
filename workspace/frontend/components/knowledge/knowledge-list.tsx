'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Folder, FolderPlus, Plus, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLayout } from '@/components/layout/layout-context';
import { ListToggleButton } from '@/components/layout/list-collapse-button';
import { knowledgeTitle } from '@/lib/knowledge-title';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import type { KnowledgeEntry } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { KnowledgeEditor } from './knowledge-editor';
import { KnowledgeEntryRow } from './knowledge-entry-row';
import { KnowledgeFolderDialog } from './knowledge-folder-dialog';
import { ArtifactShareDialog } from '@/components/sharing/artifact-share';

/**
 * Knowledge entries in the shell's list panel, matching the thread list:
 * a header on the shared `--header-height` baseline, a search row, then rows.
 */
export function KnowledgeList() {
  const {
    knowledge, sessions, refreshKnowledge, deleteKnowledge,
    selectedKnowledgeId, setSelectedKnowledgeId,
    updateKnowledge,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const t = useT();

  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const loadFolders = useCallback(() => workspaceApi.listKnowledgeFolders().then(setFolders).catch(() => toast.error(t('knowledge.loadFailed'))), [t]);
  useEffect(() => { void loadFolders(); }, [loadFolders]);
  useEffect(() => {
    const selected = knowledge.find(entry => entry.id === selectedKnowledgeId);
    if (selected) setFolder(selected.folderPath || '');
  }, [selectedKnowledgeId, knowledge]);
  const childFolders = folders.filter(path => path.split('/').slice(0, -1).join('/') === folder);
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
        knowledgeTitle(e.title, sessions).toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q),
    );
  }, [knowledge, sessions, query, folder]);

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
        <div className="flex min-w-0 items-center gap-1.5">
          <ListToggleButton className="-ml-1 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm leading-relaxed font-semibold">{t('knowledge.title')}</span>
          {knowledge.length > 0 && (
            <Badge variant="secondary">
              {knowledge.length}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="sm" className="me-1 shrink-0" onClick={openNew}>
            <Plus data-icon="inline-start" />
            {t('knowledge.newEntry')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('knowledge.refresh')}
                onClick={refreshKnowledge}
                className="text-muted-foreground"
              >
                <RefreshCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.refresh')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="shrink-0 px-3 pt-3">
        <button type="button" onClick={() => { setSelectedKnowledgeId(null); if (isMobile) openMobileDetail(); }} className="flex w-full items-center gap-2 rounded-lg bg-indigo-500/[0.06] px-3 py-2.5 text-start text-xs font-medium text-indigo-700 hover:bg-indigo-500/10 focus-visible:outline-2 focus-visible:outline-ring dark:text-indigo-300">
          <BookOpen className="size-4 shrink-0" />{t('knowledge.library.overview')}<ChevronRight className="ms-auto size-3.5 shrink-0" />
        </button>
        <p className="px-1 pt-2 text-xs leading-5 text-muted-foreground">{t('knowledge.library.listHint')}</p>
      </div>
      {/* Search */}
      <div className="shrink-0 px-3 pt-3 pb-1">
        <InputGroup className="bg-muted/30">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={t('knowledge.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('knowledge.searchLabel')}
            className="text-xs"
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={() => setQuery('')} aria-label={t('knowledge.clearSearch')}>
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-muted-foreground">
        {folder && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('knowledge.parentFolder')}
            onClick={() => { setFolder(folder.split('/').slice(0, -1).join('/')); setSelectedKnowledgeId(null); setQuery(''); }}
          >
            <ArrowLeft />
          </Button>
        )}
        <span className="min-w-0 flex-1 truncate" title={'/' + folder}>{folder ? '/' + folder : t('knowledge.rootFolder')}</span>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => setNewFolderOpen(true)}>
          <FolderPlus data-icon="inline-start" />
          {t('knowledge.newFolder')}
        </Button>
      </div>
      {/* Rows */}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:flex! [&>div]:min-h-full [&>div]:flex-col">
        {!query && childFolders.map(path => (
          <Button
            key={path}
            variant="ghost"
            className="mx-2 mb-1 h-auto justify-start gap-2.5 px-3 py-2.5 font-normal"
            onClick={() => { setFolder(path); setSelectedKnowledgeId(null); }}
          >
            <Folder className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">{path.split('/').at(-1)}</span>
            <ChevronRight className="text-muted-foreground/60" />
          </Button>
        ))}
        {filtered.length === 0 ? (
          <Empty className="flex-1 px-4 py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpen />
              </EmptyMedia>
              <EmptyDescription className="text-xs">
                {query ? t('knowledge.emptySearch') : t('knowledge.empty')}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {query ? (
                <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                  {t('knowledge.clearSearch')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={openNew}>
                  <Plus data-icon="inline-start" />
                  {t('knowledge.createFirst')}
                </Button>
              )}
            </EmptyContent>
          </Empty>
        ) : (
          filtered.map((entry) => (
            <KnowledgeEntryRow
              key={entry.id}
              entry={entry}
              title={knowledgeTitle(entry.title, sessions)}
              selected={selectedKnowledgeId === entry.id}
              onSelect={() => select(entry)}
              onShare={() => setShareEntryId(entry.id)}
              onEdit={() => handleEdit(entry)}
              onDelete={() => handleDelete(entry)}
            />
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
      <KnowledgeFolderDialog open={newFolderOpen} parent={folder} onOpenChange={setNewFolderOpen} onCreated={loadFolders} />
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

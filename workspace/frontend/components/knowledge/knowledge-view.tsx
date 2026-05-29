'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { BookOpen, Plus, RefreshCw, Pencil, Trash2, ArrowLeft, Search } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { useLayout } from '@/components/layout/layout-context';
import { KnowledgeTree } from './knowledge-tree';
import { CreateKnowledgeDialog } from './create-knowledge-dialog';
import { KnowledgeEditor } from './knowledge-editor';
import {
  fetchKnowledgeTree,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeContent,
  type KnowledgeNode,
} from '@/lib/api-knowledge';

/** Flatten tree to get all folder nodes for the parent selector */
function flattenFolders(nodes: KnowledgeNode[]): KnowledgeNode[] {
  const result: KnowledgeNode[] = [];
  function walk(list: KnowledgeNode[]) {
    for (const node of list) {
      if (node.isFolder) {
        result.push(node);
      }
      if (node.children) walk(node.children);
    }
  }
  walk(nodes);
  return result;
}

/** Flatten tree to search all nodes */
function flattenAll(nodes: KnowledgeNode[]): KnowledgeNode[] {
  const result: KnowledgeNode[] = [];
  function walk(list: KnowledgeNode[]) {
    for (const node of list) {
      result.push(node);
      if (node.children) walk(node.children);
    }
  }
  walk(nodes);
  return result;
}

export function KnowledgeView() {
  const { agents } = useWorkspace();
  const { isMobile } = useLayout();
  const agentNames = agents.map((a) => a.agentName);

  // Tree data
  const [tree, setTree] = useState<KnowledgeNode[]>([]);
  const [loading, setLoading] = useState(true);

  // Selection
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [selectedContent, setSelectedContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Dialogs
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{
    parentId: string | null;
    knowledgeType: 'global' | 'project';
    projectId: string | null;
  }>({ parentId: null, knowledgeType: 'global', projectId: null });

  // Legacy editor (for editing existing entries)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<{ id: string; title: string; slug: string; description: string | null; content: string; contentSize: number | null; createdBy: string; updatedBy: string | null; status: string; createdAt: string | null; updatedAt: string | null } & { content: string } | null>(null);

  // Mobile pane state
  const [mobileDetail, setMobileDetail] = useState(false);

  // Load tree
  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchKnowledgeTree('default');
      setTree(data);
    } catch {
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  // Select a node
  const handleSelect = useCallback(async (node: KnowledgeNode) => {
    setSelectedNode(node);
    setMobileDetail(true);
    if (!node.isFolder) {
      setLoadingContent(true);
      try {
        const content = await getKnowledgeContent(node.id);
        setSelectedContent(content);
      } catch {
        setSelectedContent('Failed to load content.');
      } finally {
        setLoadingContent(false);
      }
    } else {
      setSelectedContent('');
    }
  }, []);

  // Create child entry from tree "+" button
  const handleCreateChild = useCallback((parentId: string | null, knowledgeType: 'global' | 'project', projectId?: string | null) => {
    setCreateDefaults({
      parentId,
      knowledgeType,
      projectId: projectId || null,
    });
    setCreateDialogOpen(true);
  }, []);

  // Save new entry
  const handleSaveNew = useCallback(async (entry: Partial<KnowledgeNode> & { workspaceId?: string }) => {
    await createKnowledgeEntry({ ...entry, workspaceId: 'default' });
    await loadTree();
  }, [loadTree]);

  // Delete entry
  const handleDelete = useCallback(async () => {
    if (!selectedNode) return;
    await deleteKnowledgeEntry(selectedNode.id);
    setSelectedNode(null);
    setSelectedContent('');
    await loadTree();
  }, [selectedNode, loadTree]);

  // Edit entry (opens legacy editor in edit mode)
  const handleEdit = useCallback(() => {
    if (!selectedNode) return;
    setEditingEntry({
      id: selectedNode.id,
      title: selectedNode.title,
      slug: selectedNode.slug,
      description: null,
      content: selectedContent,
      contentSize: selectedContent.length,
      createdBy: selectedNode.createdBy || '',
      updatedBy: null,
      status: 'active',
      createdAt: null,
      updatedAt: selectedNode.updatedAt,
    });
    setEditorOpen(true);
  }, [selectedNode, selectedContent]);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
    setEditingEntry(null);
  }, []);

  const handleEditorSaved = useCallback(async () => {
    setEditorOpen(false);
    setEditingEntry(null);
    await loadTree();
    if (selectedNode) {
      try {
        const content = await getKnowledgeContent(selectedNode.id);
        setSelectedContent(content);
      } catch { /* ignore */ }
    }
  }, [loadTree, selectedNode]);

  // Filtered tree for search
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return tree;
    const q = searchQuery.toLowerCase();
    const allNodes = flattenAll(tree);
    return allNodes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q)
    );
  }, [tree, searchQuery]);

  // All folders for parent selector
  const allFolders = useMemo(() => flattenFolders(tree), [tree]);

  // ----- LEFT PANEL: Tree + Search -----
  const LeftPanel = (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Knowledge</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setCreateDefaults({ parentId: null, knowledgeType: 'global', projectId: null });
              setCreateDialogOpen(true);
            }}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="New entry"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            onClick={loadTree}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search knowledge..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Tree or search results */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : searchQuery.trim() ? (
          // Search results (flat list)
          <div className="py-2">
            {filteredTree.length === 0 ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">No results found</p>
            ) : (
              filteredTree.map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleSelect(node)}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors ${
                    selectedNode?.id === node.id ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'
                  }`}
                >
                  <span className="truncate block">{node.title}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {node.knowledgeType === 'global' ? '🌐 Global' : '📁 Project'} · {node.slug}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : (
          // Full tree view
          <KnowledgeTree
            tree={tree}
            selectedId={selectedNode?.id || null}
            onSelect={handleSelect}
            onCreateChild={handleCreateChild}
          />
        )}
      </div>
    </div>
  );

  // ----- RIGHT PANEL: Content Viewer -----
  const RightPanel = selectedNode && !selectedNode.isFolder ? (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {isMobile && (
            <button
              onClick={() => setMobileDetail(false)}
              className="p-1 -ml-1 rounded hover:bg-muted"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <h2 className="text-sm font-semibold truncate">{selectedNode.title}</h2>
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
            {selectedNode.knowledgeType === 'global' ? '🌐' : '📁'} {selectedNode.slug}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleEdit}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Edit"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loadingContent ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownContent content={selectedContent} agentNames={agentNames} />
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
      <BookOpen className="size-8 opacity-30" />
      <p className="text-sm">Select an entry to view</p>
      <p className="text-xs opacity-60">Choose from the knowledge tree on the left</p>
    </div>
  );

  // Mobile: single pane switching
  if (isMobile) {
    return (
      <>
        {mobileDetail && selectedNode ? RightPanel : LeftPanel}
        <CreateKnowledgeDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          onSave={handleSaveNew}
          defaultParentId={createDefaults.parentId}
          defaultKnowledgeType={createDefaults.knowledgeType}
          defaultProjectId={createDefaults.projectId}
          folders={allFolders}
        />
        <KnowledgeEditor
          open={editorOpen}
          entry={editingEntry}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
        />
      </>
    );
  }

  // Desktop: split view
  return (
    <>
      <div className="h-full flex">
        <div className="w-[300px] xl:w-[360px] shrink-0 border-r border-border overflow-hidden">
          {LeftPanel}
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          {RightPanel}
        </div>
      </div>
      <CreateKnowledgeDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSave={handleSaveNew}
        defaultParentId={createDefaults.parentId}
        defaultKnowledgeType={createDefaults.knowledgeType}
        defaultProjectId={createDefaults.projectId}
        folders={allFolders}
      />
      <KnowledgeEditor
        open={editorOpen}
        entry={editingEntry}
        onClose={handleEditorClose}
        onSaved={handleEditorSaved}
      />
    </>
  );
}

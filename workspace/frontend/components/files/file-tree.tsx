'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Folder, Loader2, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  extension?: string;
}

function getFileEmoji(extension?: string): string {
  if (!extension) return '📄';
  switch (extension.toLowerCase()) {
    case 'md':
    case 'mdx':
      return '📄';
    case 'pdf':
      return '📑';
    case 'csv':
    case 'xlsx':
    case 'xls':
      return '📊';
    case 'docx':
    case 'doc':
      return '📝';
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return '🔧';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return '🖼️';
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'py':
      return '💻';
    default:
      return '📄';
  }
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TreeNodeProps {
  node: FileNode;
  level: number;
  onSelectFile: (path: string) => void;
  selectedPath?: string;
  searchQuery?: string;
}

function TreeNode({ node, level, onSelectFile, selectedPath, searchQuery }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(level < 1);

  // Auto-expand when searching
  useEffect(() => {
    if (searchQuery && node.type === 'directory') {
      setExpanded(true);
    }
  }, [searchQuery, node.type]);

  if (node.type === 'directory') {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md text-left transition-colors',
            'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 group'
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
        >
          <ChevronRight
            className={cn(
              'size-3.5 text-muted-foreground transition-transform shrink-0',
              expanded && 'rotate-90'
            )}
          />
          {expanded ? (
            <FolderOpen className="size-4 text-amber-500 shrink-0" />
          ) : (
            <Folder className="size-4 text-amber-500 shrink-0" />
          )}
          <span className="text-[13px] font-medium truncate">{node.name}</span>
          {hasChildren && (
            <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
              {node.children!.length}
            </span>
          )}
        </button>
        {expanded && hasChildren && (
          <div>
            {node.children!.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                level={level + 1}
                onSelectFile={onSelectFile}
                selectedPath={selectedPath}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  const isSelected = selectedPath === node.path;
  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      className={cn(
        'w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors',
        isSelected
          ? 'bg-zinc-100 dark:bg-zinc-800'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
      )}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
    >
      <span className="text-sm shrink-0">{getFileEmoji(node.extension)}</span>
      <span className="text-[13px] truncate flex-1">{node.name}</span>
      {node.size !== undefined && node.size > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          {formatSize(node.size)}
        </span>
      )}
    </button>
  );
}

interface FileTreeProps {
  onSelectFile: (path: string) => void;
  selectedPath?: string;
}

export function FileTree({ onSelectFile, selectedPath }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/local-files?depth=3');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTree(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Filter tree nodes by search
  const filterTree = useCallback((node: FileNode, query: string): FileNode | null => {
    if (!query) return node;
    const lowerQuery = query.toLowerCase();

    if (node.type === 'file') {
      return node.name.toLowerCase().includes(lowerQuery) ? node : null;
    }

    // Directory: filter children recursively
    const filteredChildren = (node.children || [])
      .map((child) => filterTree(child, query))
      .filter(Boolean) as FileNode[];

    if (filteredChildren.length === 0 && !node.name.toLowerCase().includes(lowerQuery)) {
      return null;
    }

    return { ...node, children: filteredChildren };
  }, []);

  const displayTree = tree && search ? filterTree(tree, search) : tree;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <p className="text-sm">{error}</p>
        <button
          onClick={fetchTree}
          className="text-xs text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-2 pb-2 shrink-0">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter files..."
          className="w-full text-xs px-2.5 py-1.5 rounded-md bg-muted/50 border border-input outline-none text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1">
        {displayTree && displayTree.children && displayTree.children.length > 0 ? (
          displayTree.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={0}
              onSelectFile={onSelectFile}
              selectedPath={selectedPath}
              searchQuery={search}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FolderOpen className="size-8 opacity-30 mb-2" />
            <p className="text-sm">
              {search ? 'No files match your filter' : 'No files found'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

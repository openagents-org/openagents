'use client';

import { useState, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Globe,
  FolderKanban,
  Plus,
} from 'lucide-react';
import type { KnowledgeNode } from '@/lib/api-knowledge';

interface KnowledgeTreeProps {
  tree: KnowledgeNode[];
  selectedId: string | null;
  onSelect: (node: KnowledgeNode) => void;
  onCreateChild?: (parentId: string | null, knowledgeType: 'global' | 'project', projectId?: string | null) => void;
}

interface TreeNodeProps {
  node: KnowledgeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (node: KnowledgeNode) => void;
  onCreateChild?: (parentId: string | null, knowledgeType: 'global' | 'project', projectId?: string | null) => void;
}

function TreeNodeItem({ node, depth, selectedId, onSelect, onCreateChild }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = node.id === selectedId;
  const hasChildren = node.children && node.children.length > 0;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isFolder) {
      setExpanded(!expanded);
    }
  };

  const handleSelect = () => {
    if (!node.isFolder) {
      onSelect(node);
    } else {
      setExpanded(!expanded);
    }
  };

  const handleAddChild = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCreateChild?.(node.id, node.knowledgeType, node.projectId);
  };

  const iconForNode = () => {
    if (node.isFolder) {
      return expanded ? (
        <FolderOpen className="size-4 text-amber-500 shrink-0" />
      ) : (
        <Folder className="size-4 text-amber-500 shrink-0" />
      );
    }
    return <FileText className="size-4 text-muted-foreground shrink-0" />;
  };

  return (
    <div>
      <button
        onClick={handleSelect}
        className={`w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md text-left text-sm transition-colors group ${
          isSelected
            ? 'bg-primary/10 text-primary font-medium'
            : 'hover:bg-muted text-foreground'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Chevron for folders */}
        {node.isFolder ? (
          <button
            onClick={handleToggle}
            className="p-0.5 rounded hover:bg-muted shrink-0"
          >
            {expanded ? (
              <ChevronDown className="size-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {iconForNode()}

        <span className="truncate flex-1">{node.title}</span>

        {/* Add child button for folders */}
        {node.isFolder && onCreateChild && (
          <button
            onClick={handleAddChild}
            className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            title="Add entry"
          >
            <Plus className="size-3 text-muted-foreground" />
          </button>
        )}
      </button>

      {/* Children */}
      {node.isFolder && expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function KnowledgeTree({ tree, selectedId, onSelect, onCreateChild }: KnowledgeTreeProps) {
  // Separate global and project nodes
  const globalNodes = tree.filter((n) => n.knowledgeType === 'global');
  const projectNodes = tree.filter((n) => n.knowledgeType === 'project');

  // Group project nodes by projectId
  const projectGroups = new Map<string, { name: string; nodes: KnowledgeNode[] }>();
  for (const node of projectNodes) {
    const pid = node.projectId || 'unknown';
    if (!projectGroups.has(pid)) {
      projectGroups.set(pid, { name: pid, nodes: [] });
    }
    projectGroups.get(pid)!.nodes.push(node);
  }

  const [globalExpanded, setGlobalExpanded] = useState(true);
  const [projectExpandedMap, setProjectExpandedMap] = useState<Record<string, boolean>>({});

  const toggleProject = useCallback((pid: string) => {
    setProjectExpandedMap((prev) => ({ ...prev, [pid]: !(prev[pid] ?? true) }));
  }, []);

  return (
    <div className="py-2 space-y-1">
      {/* Global Knowledge Section */}
      <div>
        <button
          onClick={() => setGlobalExpanded(!globalExpanded)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors group"
        >
          {globalExpanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <Globe className="size-3.5" />
          <span className="flex-1 text-left">Global Knowledge</span>
          {onCreateChild && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateChild(null, 'global', null);
              }}
              className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
              title="Add global entry"
            >
              <Plus className="size-3" />
            </button>
          )}
        </button>
        {globalExpanded && (
          <div className="ml-1">
            {globalNodes.map((node) => (
              <TreeNodeItem
                key={node.id}
                node={node}
                depth={1}
                selectedId={selectedId}
                onSelect={onSelect}
                onCreateChild={onCreateChild}
              />
            ))}
            {globalNodes.length === 0 && (
              <p className="px-4 py-2 text-xs text-muted-foreground">No global entries</p>
            )}
          </div>
        )}
      </div>

      {/* Project Knowledge Sections */}
      {Array.from(projectGroups.entries()).map(([pid, group]) => {
        const isExpanded = projectExpandedMap[pid] ?? true;
        // Derive a display name from the project ID
        const displayName = group.name
          .replace(/^proj-/, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());

        return (
          <div key={pid}>
            <button
              onClick={() => toggleProject(pid)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors group"
            >
              {isExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <FolderKanban className="size-3.5" />
              <span className="flex-1 text-left">{displayName}</span>
              {onCreateChild && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateChild(null, 'project', pid);
                  }}
                  className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                  title={`Add entry to ${displayName}`}
                >
                  <Plus className="size-3" />
                </button>
              )}
            </button>
            {isExpanded && (
              <div className="ml-1">
                {group.nodes.map((node) => (
                  <TreeNodeItem
                    key={node.id}
                    node={node}
                    depth={1}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onCreateChild={onCreateChild}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

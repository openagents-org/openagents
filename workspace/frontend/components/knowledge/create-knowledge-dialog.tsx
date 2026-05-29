'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { KnowledgeNode } from '@/lib/api-knowledge';
import { MOCK_PROJECTS } from '@/lib/api-knowledge';

interface CreateKnowledgeDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (entry: Partial<KnowledgeNode> & { workspaceId?: string }) => Promise<void>;
  /** Pre-filled parent info when "+" is clicked on a folder */
  defaultParentId?: string | null;
  defaultKnowledgeType?: 'global' | 'project';
  defaultProjectId?: string | null;
  /** Flat list of folders for parent selector */
  folders: KnowledgeNode[];
}

const CATEGORY_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'prd', label: 'PRD' },
  { value: 'design', label: 'Design' },
  { value: 'api', label: 'API' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'other', label: 'Other' },
];

export function CreateKnowledgeDialog({
  open,
  onClose,
  onSave,
  defaultParentId = null,
  defaultKnowledgeType = 'global',
  defaultProjectId = null,
  folders,
}: CreateKnowledgeDialogProps) {
  const [title, setTitle] = useState('');
  const [knowledgeType, setKnowledgeType] = useState<'global' | 'project'>(defaultKnowledgeType);
  const [projectId, setProjectId] = useState<string>(defaultProjectId || '');
  const [parentId, setParentId] = useState<string>(defaultParentId || '');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset form when dialog opens with new defaults
  useEffect(() => {
    if (open) {
      setTitle('');
      setKnowledgeType(defaultKnowledgeType);
      setProjectId(defaultProjectId || '');
      setParentId(defaultParentId || '');
      setCategory('');
      setContent('');
    }
  }, [open, defaultParentId, defaultKnowledgeType, defaultProjectId]);

  // Filter folders based on selected knowledge type and project
  const availableFolders = folders.filter((f) => {
    if (knowledgeType === 'global') return f.knowledgeType === 'global';
    return f.knowledgeType === 'project' && f.projectId === projectId;
  });

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        content: content.trim(),
        contentType: 'markdown',
        knowledgeType,
        projectId: knowledgeType === 'project' ? projectId || null : null,
        parentId: parentId || null,
        category: category || null,
        position: 0,
        isFolder: false,
      });
      onClose();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>New Knowledge Entry</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto py-2">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="create-kb-title">Title</Label>
            <Input
              id="create-kb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. API Design Patterns"
            />
          </div>

          {/* Type selector */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="create-kb-type">Type</Label>
              <select
                id="create-kb-type"
                value={knowledgeType}
                onChange={(e) => {
                  setKnowledgeType(e.target.value as 'global' | 'project');
                  setParentId('');
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="global">🌐 Global</option>
                <option value="project">📁 Project</option>
              </select>
            </div>

            {/* Project selector (only when type=project) */}
            {knowledgeType === 'project' && (
              <div className="space-y-2">
                <Label htmlFor="create-kb-project">Project</Label>
                <select
                  id="create-kb-project"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setParentId('');
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">— Select project —</option>
                  {MOCK_PROJECTS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Parent folder selector */}
          <div className="space-y-2">
            <Label htmlFor="create-kb-parent">Parent Folder (optional)</Label>
            <select
              id="create-kb-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">— Root level —</option>
              {availableFolders.map((f) => (
                <option key={f.id} value={f.id}>{f.title}</option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="create-kb-category">Category (optional)</Label>
            <select
              id="create-kb-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="create-kb-content">Content (Markdown)</Label>
            <textarea
              id="create-kb-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your knowledge entry in Markdown..."
              className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
          >
            {saving ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

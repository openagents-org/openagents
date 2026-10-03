'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/responsive-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import type { ArtifactVisibility, KnowledgeEntry } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { Globe, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KnowledgeEditorProps {
  open: boolean;
  entry: (KnowledgeEntry & { content: string }) | null;
  onClose: () => void;
  onSaved: () => void;
}

export function KnowledgeEditor({ open, entry, onClose, onSaved }: KnowledgeEditorProps) {
  const { createKnowledge, updateKnowledge } = useWorkspace();
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  // Permission model v1.1 — new entries are private by default (spec §4).
  const [visibility, setVisibility] = useState<ArtifactVisibility>('private');
  const [saving, setSaving] = useState(false);

  const isEditing = !!entry;

  useEffect(() => {
    if (open) {
      if (entry) {
        setTitle(entry.title);
        setDescription(entry.description || '');
        setContent(entry.content || '');
        setVisibility(entry.visibility ?? 'public');
      } else {
        setTitle('');
        setDescription('');
        setContent('');
        setVisibility('private');
      }
    }
  }, [open, entry]);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (isEditing && entry) {
        await updateKnowledge(entry.id, {
          title: title.trim(),
          content: content.trim(),
          description: description.trim() || undefined,
          // Only owners/admins may flip visibility — send it only when changed.
          ...(visibility !== (entry.visibility ?? 'public') ? { visibility } : {}),
        });
      } else {
        await createKnowledge({
          title: title.trim(),
          content: content.trim(),
          description: description.trim() || undefined,
          visibility,
        });
      }
      onSaved();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('knowledge.editorTitleEdit') : t('knowledge.editorTitleNew')}</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="kb-title">{t('knowledge.fieldTitle')}</Label>
            <Input
              id="kb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('knowledge.fieldTitlePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="kb-description">{t('knowledge.fieldDescription')}</Label>
            <Input
              id="kb-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('knowledge.fieldDescriptionPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('artifactAccess.visibility')}</Label>
            <div className="flex gap-1.5" role="radiogroup" aria-label={t('artifactAccess.visibility')}>
              {(['private', 'public'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={visibility === v}
                  onClick={() => setVisibility(v)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors',
                    visibility === v ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {v === 'private' ? <Lock className="size-3.5" /> : <Globe className="size-3.5" />}
                  {t(v === 'private' ? 'artifactAccess.private' : 'artifactAccess.public')}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {visibility === 'private' ? t('artifactAccess.privateHint') : t('artifactAccess.publicHint')}
              {!isEditing && ` ${t('artifactAccess.newEntryVisibilityHint')}`}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="kb-content">{t('knowledge.fieldContent')}</Label>
            <textarea
              id="kb-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('knowledge.fieldContentPlaceholder')}
              className="w-full min-h-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}>
            {saving ? t('common.saving') : isEditing ? t('knowledge.saveChanges') : t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

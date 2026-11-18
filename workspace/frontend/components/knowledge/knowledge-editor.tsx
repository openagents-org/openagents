'use client';

import { workspaceApi } from '@/lib/api';
import { toast } from 'sonner';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useWorkspace } from '@/lib/workspace-context';
import type { ArtifactVisibility, KnowledgeEntry } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { Globe, Lock } from 'lucide-react';

/** The root folder, as a value a Select can hold (Radix reserves ''). */
const ROOT_FOLDER = '__root__';

interface KnowledgeEditorProps {
  open: boolean;
  defaultFolder?: string;
  draft?: { title: string; content: string };
  entry: (KnowledgeEntry & { content: string }) | null;
  onClose: () => void;
  onSaved: () => void;
}

export function KnowledgeEditor({ open, entry, onClose, onSaved, defaultFolder = "", draft }: KnowledgeEditorProps) {
  const { createKnowledge, updateKnowledge } = useWorkspace();
  const t = useT();
  const [folders, setFolders] = useState<string[]>([]);
  const [folderPath, setFolderPath] = useState('');
  useEffect(() => { if (open) workspaceApi.listKnowledgeFolders().then(setFolders).catch(() => toast.error(t('knowledge.loadFailed'))); }, [open, t]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // Permission model v1.1 — new entries are private by default (spec §4).
  const [visibility, setVisibility] = useState<ArtifactVisibility>('private');
  const [saving, setSaving] = useState(false);

  const isEditing = !!entry;

  useEffect(() => {
    if (open) {
      setFolderPath(entry ? entry.folderPath || '' : defaultFolder);
      if (entry) {
        setTitle(entry.title);
        setContent(entry.content || '');
        setVisibility(entry.visibility ?? 'public');
      } else {
        setTitle(draft?.title || '');
        setContent(draft?.content || '');
        setVisibility('private');
      }
    }
  }, [open, entry, defaultFolder, draft]);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (isEditing && entry) {
        await updateKnowledge(entry.id, {
          title: title.trim(),
          folderPath,
          content: content.trim(),
          // Only owners/admins may flip visibility — send it only when changed.
          ...(visibility !== (entry.visibility ?? 'public') ? { visibility } : {}),
        });
      } else {
        await createKnowledge({
          title: title.trim(),
          folderPath,
          content: content.trim(),
          visibility,
        });
      }
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("knowledge.loadFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('knowledge.editorTitleEdit') : t('knowledge.editorTitleNew')}</DialogTitle>
          {!isEditing && <p className="text-sm leading-6 text-muted-foreground">{t('knowledge.library.editorHint')}</p>}
        </DialogHeader>

        <DialogBody>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="kb-folder">{t('knowledge.folder')}</FieldLabel>
              <Select
                value={folderPath || ROOT_FOLDER}
                onValueChange={(v) => setFolderPath(v === ROOT_FOLDER ? '' : v)}
              >
                <SelectTrigger id="kb-folder" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={ROOT_FOLDER}>{t('knowledge.rootFolder')}</SelectItem>
                    {folders.map((path) => (
                      <SelectItem key={path} value={path}>/{path}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="kb-title">{t('knowledge.fieldTitle')}</FieldLabel>
              <Input
                id="kb-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('knowledge.fieldTitlePlaceholder')}
              />
            </Field>

            <Field>
              <FieldLabel>{t('artifactAccess.visibility')}</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                value={visibility}
                onValueChange={(v) => { if (v) setVisibility(v as ArtifactVisibility); }}
                aria-label={t('artifactAccess.visibility')}
                className="w-full"
              >
                {(['private', 'public'] as const).map((v) => (
                  <ToggleGroupItem key={v} value={v} className="flex-1">
                    {v === 'private' ? <Lock /> : <Globe />}
                    {t(v === 'private' ? 'artifactAccess.private' : 'artifactAccess.public')}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>
                {visibility === 'private' ? t('artifactAccess.privateHint') : t('artifactAccess.publicHint')}
                {!isEditing && ` ${t('artifactAccess.newEntryVisibilityHint')}`}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="kb-content">{t('knowledge.fieldContent')}</FieldLabel>
              <Textarea
                id="kb-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('knowledge.fieldContentPlaceholder')}
                className="min-h-72 resize-y font-mono"
              />
            </Field>
          </FieldGroup>
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

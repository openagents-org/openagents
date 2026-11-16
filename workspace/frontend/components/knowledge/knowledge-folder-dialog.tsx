'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Name a new folder under `parent`. Names are one path segment — no slashes. */
export function KnowledgeFolderDialog({
  open,
  parent,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  parent: string;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<unknown>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = !!name.trim() && !name.includes('/');

  const create = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await workspaceApi.createKnowledgeFolder([parent, name.trim()].filter(Boolean).join('/'));
      await onCreated();
      onOpenChange(false);
      setName('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('knowledge.loadFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('knowledge.newFolder')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldDescription>{t('knowledge.folderHint')}</FieldDescription>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('knowledge.folderName')}
              aria-label={t('knowledge.folderName')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void create();
                }
              }}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={saving || !valid} onClick={() => void create()}>{t('common.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

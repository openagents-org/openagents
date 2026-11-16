'use client';

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { AttachmentPicker, KnowledgeContextPicker } from '@/components/tasks/new-task-dialog';
import { useT } from '@/lib/i18n';
import type { Workflow } from '@/lib/types';

export type RunWorkflowInput = { title: string; description: string; knowledgeIds: string[]; fileIds: string[] };

/** "New task with this workflow": what to work on, plus optional context. */
export function RunWorkflowDialog({
  workflow,
  onOpenChange,
  onSubmit,
}: {
  workflow: Workflow | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: RunWorkflowInput) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);

  useEffect(() => {
    if (workflow) {
      setTitle('');
      setDescription('');
      setKnowledgeIds([]);
      setFileIds([]);
    }
  }, [workflow]);

  const submit = () => {
    // Description is required; an empty title gets a derived preview
    // ("first few words…") from the backend.
    if (!description.trim()) return;
    onSubmit({ title: title.trim(), description: description.trim(), knowledgeIds, fileIds });
    onOpenChange(false);
  };

  return (
    <Dialog open={!!workflow} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('workflows.newTaskWith', { name: workflow?.name ?? '' })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="run-workflow-description" className="sr-only">
                {t('tasks.fieldDescriptionPlaceholder')}
              </FieldLabel>
              <Textarea
                id="run-workflow-description"
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('tasks.fieldDescriptionPlaceholder')}
                rows={4}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="run-workflow-title" className="sr-only">
                {t('tasks.fieldTitlePlaceholder')}
              </FieldLabel>
              <Input
                id="run-workflow-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('tasks.fieldTitlePlaceholder')}
              />
            </Field>
            <KnowledgeContextPicker value={knowledgeIds} onChange={setKnowledgeIds} />
            <AttachmentPicker value={fileIds} onChange={setFileIds} />
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!description.trim()}>
            <Play data-icon="inline-start" />
            {t('workflows.createAndRun')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

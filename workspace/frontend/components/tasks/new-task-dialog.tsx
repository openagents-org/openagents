'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  SelectGroup, Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { CircleAlert } from 'lucide-react';
import type { KanbanTask } from '@/lib/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AttachmentPicker } from './attachment-picker';
import { KnowledgeContextPicker } from './knowledge-context-picker';

// Re-exported: workflows and issues import both pickers from here.
export { AttachmentPicker, KnowledgeContextPicker };

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing task to edit; null/undefined = create a new one. */
  task?: KanbanTask | null;
  issueTitle?: string;
  onSubmit: (input: {
    title: string;
    description: string;
    /** Bare agent name to pre-assign, or null. Does not run it. */
    assignee: string | null;
    /** Workflow to run instead of a single agent, or null. */
    workflowId: string | null;
    /** Knowledge entries attached as context. */
    knowledgeIds: string[];
    /** Workspace files attached (uploaded on pick). */
    fileIds: string[];
  }) => void | Promise<unknown>;
}

// Radix Select reserves the empty string for "nothing selected", so the
// unassigned choice needs its own sentinel value.
const UNASSIGNED = '__unassigned__';

export function NewTaskDialog({ open, onOpenChange, task, onSubmit, issueTitle }: NewTaskDialogProps) {
  const t = useT();
  const { agents, workflows } = useWorkspace();
  const onlineAgents = agents.filter((a) => a.status === 'online');
  const isEdit = !!task;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [runWith, setRunWith] = useState<'agent' | 'workflow'>('agent');
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [workflowId, setWorkflowId] = useState<string>(UNASSIGNED);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setError('');
      setTitle(task?.title ?? issueTitle ?? '');
      setDescription(task?.description ?? '');
      setRunWith(task?.workflowId ? 'workflow' : 'agent');
      setAssignee(task?.assignee ?? UNASSIGNED);
      setWorkflowId(task?.workflowId ?? UNASSIGNED);
      setKnowledgeIds(task?.knowledgeIds ?? []);
      setFileIds(task?.fileIds ?? []);
    }
  }, [open, task]);

  const handleSubmit = async () => {
    // Description is the task; the title is an optional board label — when
    // empty, the backend derives a "first few words…" preview from the
    // description (and re-derives on edit).
    if (!description.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        assignee: runWith === 'agent' && assignee !== UNASSIGNED ? assignee : null,
        workflowId: runWith === 'workflow' && workflowId !== UNASSIGNED ? workflowId : null,
        knowledgeIds,
        fileIds,
      });
      onOpenChange(false);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'issueWork.edit' : issueTitle ? 'issueWork.add' : 'tasks.newTaskTitle')}</DialogTitle>
          {!isEdit && (
            <DialogDescription>
              {t(issueTitle ? 'issueWork.setupHint' : 'tasks.newTaskDescription')}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogBody>
          <FieldGroup className="gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="new-task-description" className="text-xs text-muted-foreground">
                {t('tasks.fieldDescription')}
              </FieldLabel>
              <Textarea
                id="new-task-description"
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('tasks.fieldDescriptionPlaceholder')}
                rows={5}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
                }}
              />
            </Field>

            <Field className="gap-1.5">
              <FieldLabel htmlFor="new-task-title" className="text-xs text-muted-foreground">
                {t('tasks.fieldTitle')}
                <span className="font-normal text-muted-foreground/60">({t('common.optional')})</span>
              </FieldLabel>
              <Input
                id="new-task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('tasks.fieldTitlePlaceholder')}
              />
            </Field>

            <KnowledgeContextPicker value={knowledgeIds} onChange={setKnowledgeIds} />
            <AttachmentPicker value={fileIds} onChange={setFileIds} />

            <Field className="gap-1.5">
              <FieldLabel className="text-xs text-muted-foreground">{t('tasks.runWith')}</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={runWith}
                onValueChange={(v) => { if (v) setRunWith(v as 'agent' | 'workflow'); }}
                className="w-full"
              >
                <ToggleGroupItem value="agent" className="flex-1">{t('tasks.runWithAgent')}</ToggleGroupItem>
                <ToggleGroupItem value="workflow" className="flex-1">{t('tasks.runWithWorkflow')}</ToggleGroupItem>
              </ToggleGroup>

              {runWith === 'agent' ? (
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger className="w-full" aria-label={t('tasks.runWithAgent')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNASSIGNED}>{t('tasks.assigneeUnassigned')}</SelectItem>
                      {onlineAgents.map((a) => (
                        <SelectItem key={a.agentName} value={a.agentName}>
                          <span className="flex items-center gap-2">
                            <AgentAvatar name={a.agentName} size={18} />
                            <span className="truncate">{agentLabel(a)}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <Select value={workflowId} onValueChange={setWorkflowId}>
                  <SelectTrigger className="w-full" aria-label={t('tasks.runWithWorkflow')}>
                    <SelectValue placeholder={t('tasks.pickWorkflow')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {workflows.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('tasks.noWorkflows')}</div>
                      ) : (
                        workflows.map((w) => (
                          <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                        ))
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              <FieldDescription className="text-xs">{t('tasks.assigneeHint')}</FieldDescription>
            </Field>
          </FieldGroup>
        </DialogBody>

        {/* Outside the scrolling body, so a failed save is never below the fold. */}
        {error && (
          <div className="shrink-0 px-4 pb-3">
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="min-w-24" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleSubmit} disabled={saving || !description.trim()}>
            {saving && <Spinner data-icon="inline-start" />}
            {t(saving ? 'common.saving' : isEdit ? 'common.save' : 'tasks.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

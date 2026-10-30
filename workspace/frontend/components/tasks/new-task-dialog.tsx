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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import { BookOpen, Check } from 'lucide-react';
import type { KanbanTask } from '@/lib/types';
import { AttachmentPicker } from './attachment-picker';

/**
 * Multi-select of knowledge-base entries to attach as task context. Rendered
 * INLINE (a checkbox list) rather than as a portal dropdown — a nested Radix
 * portal inside the modal was easy to miss and flaky on mobile drawers. The
 * backend cites each entry as @knowledge:<slug> in the kickoff. Renders
 * nothing when the knowledge base is empty.
 */
export function KnowledgeContextPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  const { knowledge } = useWorkspace();
  if (knowledge.length === 0) return null;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <BookOpen className="size-3.5" />
        {t('tasks.fieldContext')}
        {value.length > 0 && (
          <span className="font-normal text-muted-foreground/70">
            · {t('tasks.contextCount', { count: value.length })}
          </span>
        )}
      </label>
      <div className="max-h-40 overflow-y-auto rounded-md border border-input divide-y divide-border/60">
        {knowledge.map((entry) => {
          const checked = value.includes(entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => toggle(entry.id)}
              className={cn(
                'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/50',
                checked && 'bg-primary/5',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                )}
              >
                {checked && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{entry.title}</span>
                {entry.description && (
                  <span className="block truncate text-[10px] text-muted-foreground">{entry.description}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground/70">{t('tasks.contextHint')}</p>
    </div>
  );
}

export { AttachmentPicker };

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
        <DialogHeader className="space-y-2 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">{t(isEdit ? 'issueWork.edit' : issueTitle ? 'issueWork.add' : 'tasks.newTaskTitle')}</DialogTitle>
          {!isEdit && (
            <DialogDescription className="text-sm leading-relaxed">
              {t(issueTitle ? 'issueWork.setupHint' : 'tasks.newTaskDescription')}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogBody className="space-y-4 px-7 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('tasks.fieldDescription')}</label>
            <Textarea
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('tasks.fieldDescriptionPlaceholder')}
              rows={5}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('tasks.fieldTitle')}{' '}
              <span className="font-normal text-muted-foreground/60">({t('common.optional')})</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tasks.fieldTitlePlaceholder')}
            />
          </div>

          <KnowledgeContextPicker value={knowledgeIds} onChange={setKnowledgeIds} />
          <AttachmentPicker value={fileIds} onChange={setFileIds} />

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('tasks.runWith')}</label>
            <div className="flex gap-2">
              {(['agent', 'workflow'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRunWith(k)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    runWith === k
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-input text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {t(k === 'agent' ? 'tasks.runWithAgent' : 'tasks.runWithWorkflow')}
                </button>
              ))}
            </div>

            {runWith === 'agent' ? (
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t('tasks.assigneeUnassigned')}</SelectItem>
                  {onlineAgents.map((a) => (
                    <SelectItem key={a.agentName} value={a.agentName}>
                      <span className="flex items-center gap-2">
                        <AgentAvatar name={a.agentName} size={18} />
                        <span className="truncate">{agentLabel(a)}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select value={workflowId} onValueChange={setWorkflowId}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t('tasks.pickWorkflow')} /></SelectTrigger>
                <SelectContent>
                  {workflows.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('tasks.noWorkflows')}</div>
                  ) : (
                    workflows.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-muted-foreground/70">{t('tasks.assigneeHint')}</p>
          </div>
        </DialogBody>

        {error && <p role="alert" className="px-7 text-sm text-destructive">{error}</p>}
        <DialogFooter className="px-7 pt-4 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleSubmit} disabled={saving || !description.trim()}>
            {t(saving ? 'common.saving' : isEdit ? 'common.save' : 'tasks.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

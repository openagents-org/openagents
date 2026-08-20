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
import type { KanbanTask } from '@/lib/types';

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing task to edit; null/undefined = create a new one. */
  task?: KanbanTask | null;
  onSubmit: (input: {
    title: string;
    description: string;
    /** Bare agent name to pre-assign, or null. Does not run it. */
    assignee: string | null;
    /** Workflow to run instead of a single agent, or null. */
    workflowId: string | null;
  }) => void;
}

// Radix Select reserves the empty string for "nothing selected", so the
// unassigned choice needs its own sentinel value.
const UNASSIGNED = '__unassigned__';

export function NewTaskDialog({ open, onOpenChange, task, onSubmit }: NewTaskDialogProps) {
  const t = useT();
  const { agents, workflows } = useWorkspace();
  const onlineAgents = agents.filter((a) => a.status === 'online');
  const isEdit = !!task;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [runWith, setRunWith] = useState<'agent' | 'workflow'>('agent');
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [workflowId, setWorkflowId] = useState<string>(UNASSIGNED);

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? '');
      setDescription(task?.description ?? '');
      setRunWith(task?.workflowId ? 'workflow' : 'agent');
      setAssignee(task?.assignee ?? UNASSIGNED);
      setWorkflowId(task?.workflowId ?? UNASSIGNED);
    }
  }, [open, task]);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSubmit({
      title: trimmed,
      description: description.trim(),
      assignee: runWith === 'agent' && assignee !== UNASSIGNED ? assignee : null,
      workflowId: runWith === 'workflow' && workflowId !== UNASSIGNED ? workflowId : null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-2 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">{t(isEdit ? 'tasks.editTaskTitle' : 'tasks.newTaskTitle')}</DialogTitle>
          {!isEdit && (
            <DialogDescription className="text-sm leading-relaxed">
              {t('tasks.newTaskDescription')}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogBody className="space-y-4 px-7 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('tasks.fieldTitle')}</label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tasks.fieldTitlePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('tasks.fieldDescription')}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('tasks.fieldDescriptionPlaceholder')}
              rows={4}
            />
          </div>

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

        <DialogFooter className="px-7 pt-4 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleSubmit} disabled={!title.trim()}>
            {t(isEdit ? 'common.save' : 'tasks.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

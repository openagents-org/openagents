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
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import type { TaskPriority, TaskStatus } from '@/lib/types';

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Column the task is created in (defaults to Backlog). */
  status?: TaskStatus;
  onCreate: (input: {
    title: string;
    description: string;
    priority: TaskPriority;
    /** Bare agent name to assign on creation, or null to leave unassigned. */
    assignee: string | null;
  }) => void;
}

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high'];

// Radix Select reserves the empty string for "nothing selected", so the
// unassigned choice needs its own sentinel value.
const UNASSIGNED = '__unassigned__';

export function NewTaskDialog({ open, onOpenChange, status = 'backlog', onCreate }: NewTaskDialogProps) {
  const t = useT();
  const { agents } = useWorkspace();
  const onlineAgents = agents.filter((a) => a.status === 'online');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setPriority('normal');
      setAssignee(UNASSIGNED);
    }
  }, [open]);

  const handleCreate = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate({
      title: trimmed,
      description: description.trim(),
      priority,
      assignee: assignee === UNASSIGNED ? null : assignee,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-2 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">{t('tasks.newTaskTitle')}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t('tasks.newTaskDescription')}
          </DialogDescription>
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
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreate();
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('tasks.fieldPriority')}</label>
              <div className="flex gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition-colors',
                      priority === p
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input text-muted-foreground hover:bg-muted/50'
                    )}
                  >
                    {t(`tasks.priority.${p}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('tasks.fieldAssignee')}</label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t('tasks.assigneeUnassigned')}</SelectItem>
                  {onlineAgents.map((a) => (
                    <SelectItem key={a.agentName} value={a.agentName}>
                      <span className="flex items-center gap-2">
                        <AgentAvatar name={a.agentName} size={18} />
                        <span className="truncate">{a.agentName}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {assignee !== UNASSIGNED && (
            <p className="text-[11px] text-muted-foreground/70">{t('tasks.assigneeHint')}</p>
          )}
        </DialogBody>

        <DialogFooter className="px-7 pt-4 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleCreate} disabled={!title.trim()}>
            {assignee === UNASSIGNED ? t('tasks.create') : t('tasks.createAndAssign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

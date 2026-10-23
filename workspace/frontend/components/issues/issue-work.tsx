'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { TaskCard } from '@/components/tasks/tasks-view';
import { NewTaskDialog } from '@/components/tasks/new-task-dialog';
import { TaskChatPopup } from '@/components/tasks/task-chat-popup';
import type { KanbanTask } from '@/lib/types';

/** Execution has its own lifecycle; no action here changes issue status. */
export function IssueWork({ issueId, title }: { issueId: string; title: string }) {
  const { tasks = [], refreshTasks, createTask, updateTask, runTask, stopTask, deleteTask } = useWorkspace();
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<KanbanTask | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const runs = tasks.filter(task => task.issueId === issueId);
  const chat = runs.find(task => task.id === chatId);
  useEffect(() => { void refreshTasks(); }, [refreshTasks]);
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section className="mb-8 rounded-xl border border-border/70 bg-muted/10 p-4" aria-label={t('issues.agentWork')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-medium">{t('issues.agentWork')} <span className="ml-1 text-xs tabular-nums text-muted-foreground">{runs.length || ''}</span></h2>
      <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="size-3.5" />{t('issueWork.add')}</Button>
    </div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{t(runs.length ? 'issueWork.hint' : 'issueWork.empty')}</p>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    <fieldset disabled={busy} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 disabled:opacity-70">
      {runs.map(task => <div key={task.id} className="min-w-0 space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground">{t(`tasks.col.${task.status === 'todo' ? 'backlog' : task.status}`)}</p>
        <TaskCard task={task}
          onSetAssignee={assignee => void act(() => updateTask(task.id, { assignee }))}
          onRun={() => void act(() => runTask(task.id))}
          onStop={() => void act(() => stopTask(task.id))}
          onEdit={() => setEditing(task)}
          onDelete={() => void act(() => deleteTask(task.id))}
          onOpenChat={() => setChatId(task.id)} />
      </div>)}
    </fieldset>
    <NewTaskDialog open={adding || !!editing} issueTitle={title} task={editing}
      onOpenChange={open => { if (!open) { setAdding(false); setEditing(null); } }}
      onSubmit={async input => {
        if (editing) await updateTask(editing.id, input);
        else await createTask({ ...input, issueId, status: 'backlog' });
      }} />
    {chat?.channelName && <TaskChatPopup open sessionId={chat.channelName} taskTitle={chat.title} assignee={chat.assignee} onOpenChange={open => { if (!open) setChatId(null); }} />}
  </section>;
}

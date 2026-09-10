'use client';

import { useEffect, useRef, useState } from 'react';
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
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BookOpen, Check, FileIcon, Loader2, Paperclip, X } from 'lucide-react';
import type { KanbanTask, WorkspaceFile } from '@/lib/types';

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

const ATTACH_ACCEPT =
  'image/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.sh,.yaml,.yml,.toml,.zip';

/**
 * Attach workspace files (screenshots, logs, docs) to a task. Files upload to
 * workspace storage immediately on pick (so the ids exist when the task is
 * saved) and are delivered as attachments on the kickoff message.
 */
export function AttachmentPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  const { files } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  // Files uploaded in this dialog session — the workspace `files` list may not
  // have refreshed yet, so keep our own record for names/thumbnails.
  const [uploaded, setUploaded] = useState<WorkspaceFile[]>([]);
  const [pending, setPending] = useState<{ name: string; preview?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const resolve = (id: string): WorkspaceFile | undefined =>
    uploaded.find((f) => f.id === id) ?? files.find((f) => f.id === id);

  const addFiles = async (list: FileList | File[]) => {
    const picked = Array.from(list);
    if (picked.length === 0) return;
    setError(null);
    const previews: { name: string; preview?: string }[] = picked.map((f) => ({
      name: f.name,
      preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
    }));
    setPending((p) => [...p, ...previews]);
    try {
      const results = await Promise.all(picked.map((f) => workspaceApi.uploadFile(f)));
      setUploaded((u) => [...u, ...results]);
      onChange([...value, ...results.map((r) => r.id)]);
    } catch {
      setError(t('tasks.attachFailed'));
    } finally {
      previews.forEach((pv) => pv.preview && URL.revokeObjectURL(pv.preview));
      setPending((p) => p.filter((x) => !previews.includes(x)));
    }
  };

  const remove = (id: string) => onChange(value.filter((x) => x !== id));

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Paperclip className="size-3.5" />
        {t('tasks.fieldAttachments')}
        <span className="font-normal text-muted-foreground/60">({t('common.optional')})</span>
      </label>

      {(value.length > 0 || pending.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {value.map((id) => {
            const f = resolve(id);
            const isImage = f?.contentType.startsWith('image/');
            return (
              <div key={id} className="group relative overflow-hidden rounded-lg border bg-muted">
                {isImage && f ? (
                  <img src={workspaceApi.getFileUrl(f.id)} alt={f.filename} className="h-16 w-auto max-w-[140px] object-cover" />
                ) : (
                  <div className="flex h-16 w-24 flex-col items-center justify-center gap-1 px-2">
                    <FileIcon className="size-4 text-muted-foreground" />
                    <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                      {f?.filename ?? t('tasks.attachedFile')}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  title={t('common.remove')}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
          {pending.map((pv, i) => (
            <div key={`pending-${i}`} className="relative overflow-hidden rounded-lg border bg-muted opacity-60">
              {pv.preview ? (
                <img src={pv.preview} alt={pv.name} className="h-16 w-auto max-w-[140px] object-cover" />
              ) : (
                <div className="flex h-16 w-24 flex-col items-center justify-center gap-1 px-2">
                  <FileIcon className="size-4 text-muted-foreground" />
                  <span className="w-full truncate text-center text-[10px] text-muted-foreground">{pv.name}</span>
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-4 animate-spin text-foreground" />
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-2 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
      >
        <Paperclip className="size-3.5" />
        {t('tasks.attachAdd')}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACH_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

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
    /** Knowledge entries attached as context. */
    knowledgeIds: string[];
    /** Workspace files attached (uploaded on pick). */
    fileIds: string[];
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
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? '');
      setDescription(task?.description ?? '');
      setRunWith(task?.workflowId ? 'workflow' : 'agent');
      setAssignee(task?.assignee ?? UNASSIGNED);
      setWorkflowId(task?.workflowId ?? UNASSIGNED);
      setKnowledgeIds(task?.knowledgeIds ?? []);
      setFileIds(task?.fileIds ?? []);
    }
  }, [open, task]);

  const handleSubmit = () => {
    // Description is the task; the title is an optional board label — when
    // empty, the backend derives a "first few words…" preview from the
    // description (and re-derives on edit).
    if (!description.trim()) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      assignee: runWith === 'agent' && assignee !== UNASSIGNED ? assignee : null,
      workflowId: runWith === 'workflow' && workflowId !== UNASSIGNED ? workflowId : null,
      knowledgeIds,
      fileIds,
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

        <DialogFooter className="px-7 pt-4 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleSubmit} disabled={!description.trim()}>
            {t(isEdit ? 'common.save' : 'tasks.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

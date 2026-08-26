'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Waypoints, Plus, RefreshCw, Trash2, Pencil, ArrowRight, User, Play, Copy, ChevronDown, BookOpen,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Button } from '@/components/ui/button';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Workflow } from '@/lib/types';
import { useFormatters, useT } from '@/lib/i18n';
import { WorkflowBuilderDialog } from './workflow-builder-dialog';
import { KnowledgeContextPicker } from '@/components/tasks/new-task-dialog';

function StepPill({ step }: { step: Workflow['steps'][number] }) {
  const isAgent = step.assignee.kind === 'agent';
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px]">
      {isAgent && step.assignee.agent ? (
        <AgentAvatar name={step.assignee.agent} size={14} />
      ) : (
        <User className="size-3 text-muted-foreground" />
      )}
      <span className="max-w-28 truncate">{step.name}</span>
      {step.knowledge_id && <BookOpen className="size-3 text-muted-foreground" />}
      {step.gate && <span className="text-amber-500" title={step.gate.condition}>↺</span>}
    </span>
  );
}

type TemplateStarter = { name: string; description: string; steps: Workflow['steps'] };

/** One-click starters. Agents are intentionally left unpicked — the builder
 * opens prefilled and the user chooses who does what, which doubles as a
 * guided tour of steps and gates. */
function useTemplates(t: ReturnType<typeof useT>): { key: string; loop: boolean; tpl: TemplateStarter }[] {
  const agent = { kind: 'agent' as const, agent: null };
  return [
    {
      key: 'draftReview',
      loop: true,
      tpl: {
        name: t('workflows.tpl.draftReview.name'),
        description: t('workflows.tpl.draftReview.desc'),
        steps: [
          { id: 'step-1', name: t('workflows.tpl.draftReview.s1Name'), instruction: t('workflows.tpl.draftReview.s1Inst'), assignee: { ...agent } },
          { id: 'step-2', name: t('workflows.tpl.draftReview.s2Name'), instruction: t('workflows.tpl.draftReview.s2Inst'), assignee: { ...agent },
            gate: { condition: t('workflows.tpl.draftReview.gate'), target: 'step-1' } },
        ],
      },
    },
    {
      key: 'codeTestFix',
      loop: true,
      tpl: {
        name: t('workflows.tpl.codeTestFix.name'),
        description: t('workflows.tpl.codeTestFix.desc'),
        steps: [
          { id: 'step-1', name: t('workflows.tpl.codeTestFix.s1Name'), instruction: t('workflows.tpl.codeTestFix.s1Inst'), assignee: { ...agent } },
          { id: 'step-2', name: t('workflows.tpl.codeTestFix.s2Name'), instruction: t('workflows.tpl.codeTestFix.s2Inst'), assignee: { ...agent },
            gate: { condition: t('workflows.tpl.codeTestFix.gate'), target: 'step-1' } },
        ],
      },
    },
    {
      key: 'researchApprove',
      loop: false,
      tpl: {
        name: t('workflows.tpl.researchApprove.name'),
        description: t('workflows.tpl.researchApprove.desc'),
        steps: [
          { id: 'step-1', name: t('workflows.tpl.researchApprove.s1Name'), instruction: t('workflows.tpl.researchApprove.s1Inst'), assignee: { ...agent } },
          { id: 'step-2', name: t('workflows.tpl.researchApprove.s2Name'), instruction: t('workflows.tpl.researchApprove.s2Inst'), assignee: { ...agent } },
          { id: 'step-3', name: t('workflows.tpl.researchApprove.s3Name'), instruction: t('workflows.tpl.researchApprove.s3Inst'), assignee: { kind: 'human', human: null } },
        ],
      },
    },
  ];
}

// ── "New task with this workflow" dialog ──────────────────────────────────

function RunWorkflowDialog({
  workflow,
  onOpenChange,
  onSubmit,
}: {
  workflow: Workflow | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { title: string; description: string; knowledgeIds: string[]; run: boolean }) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);

  useEffect(() => {
    if (workflow) {
      setTitle('');
      setDescription('');
      setKnowledgeIds([]);
    }
  }, [workflow]);

  const submit = (run: boolean) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSubmit({ title: trimmed, description: description.trim(), knowledgeIds, run });
    onOpenChange(false);
  };

  return (
    <Dialog open={!!workflow} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-1 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">
            {t('workflows.newTaskWith', { name: workflow?.name ?? '' })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3 px-7 py-2">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('tasks.fieldTitlePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(true);
            }}
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('tasks.fieldDescriptionPlaceholder')}
            rows={3}
          />
          <KnowledgeContextPicker value={knowledgeIds} onChange={setKnowledgeIds} />
        </DialogBody>
        <DialogFooter className="px-7 pt-4 pb-7 sm:space-x-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline" onClick={() => submit(false)} disabled={!title.trim()}>
            {t('tasks.create')}
          </Button>
          <Button onClick={() => submit(true)} disabled={!title.trim()} className="gap-1.5">
            <Play className="size-3.5" />
            {t('workflows.createAndRun')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── View ──────────────────────────────────────────────────────────────────

export function WorkflowsView() {
  const {
    workflows, refreshWorkflows, createWorkflow, updateWorkflow, deleteWorkflow,
    tasks, createTask, runTask,
  } = useWorkspace();
  const { openView } = useLayout();
  const t = useT();
  const { timeAgo } = useFormatters();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [template, setTemplate] = useState<TemplateStarter | null>(null);
  const [runFor, setRunFor] = useState<Workflow | null>(null);
  const templates = useTemplates(t);

  useEffect(() => {
    refreshWorkflows();
  }, [refreshWorkflows]);

  // Live usage per workflow, joined from the board's tasks.
  const usage = useMemo(() => {
    const map = new Map<string, { total: number; running: number; blocked: number }>();
    for (const task of tasks) {
      if (!task.workflowId) continue;
      const u = map.get(task.workflowId) ?? { total: 0, running: 0, blocked: 0 };
      u.total += 1;
      if (task.status === 'in_progress') u.running += 1;
      if (task.status === 'need_input') u.blocked += 1;
      map.set(task.workflowId, u);
    }
    return map;
  }, [tasks]);

  const openCreate = () => { setEditing(null); setTemplate(null); setBuilderOpen(true); };
  const openEdit = (wf: Workflow) => { setEditing(wf); setTemplate(null); setBuilderOpen(true); };
  const openTemplate = (tpl: TemplateStarter) => { setEditing(null); setTemplate(tpl); setBuilderOpen(true); };

  const duplicate = (wf: Workflow) => {
    createWorkflow({
      name: `${wf.name} ${t('workflows.copySuffix')}`,
      description: wf.description,
      steps: wf.steps.map((s) => ({ ...s, assignee: { ...s.assignee }, gate: s.gate ? { ...s.gate } : undefined })),
      maxIterations: wf.maxIterations,
    });
  };

  const createTaskWith = async (wf: Workflow, input: { title: string; description: string; knowledgeIds: string[]; run: boolean }) => {
    const task = await createTask({
      title: input.title,
      description: input.description,
      workflowId: wf.id,
      knowledgeIds: input.knowledgeIds,
      status: 'backlog',
    });
    if (input.run) await runTask(task.id);
    // Land the user on the board so they see the card (running or queued).
    openView('tasks');
  };

  const templateMenuItems = (
    <>
      <DropdownMenuLabel>{t('workflows.tpl.heading')}</DropdownMenuLabel>
      {templates.map(({ key, loop, tpl }) => (
        <DropdownMenuItem key={key} onClick={() => openTemplate(tpl)} className="flex flex-col items-start gap-0.5">
          <span className="text-xs font-medium">
            {tpl.name} {loop && <span className="text-amber-500">↺</span>}
          </span>
          <span className="text-[10px] text-muted-foreground">{tpl.steps.map((s) => s.name).join(' → ')}</span>
        </DropdownMenuItem>
      ))}
    </>
  );

  return (
    <div className="h-full flex flex-col">
      <DetailHeader
        title={<>
          <Waypoints className="size-4 text-foreground" />
          <h2 className="text-sm font-semibold">{t('views.workflows')}</h2>
        </>}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="size-3.5" />
              {t('workflows.newWorkflow')}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={openCreate} className="text-xs font-medium">
              {t('workflows.blank')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {templateMenuItems}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={refreshWorkflows}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </DetailHeader>

      <div className="flex-1 overflow-y-auto">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-4">
            <Waypoints className="size-8 opacity-30 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('workflows.emptyTitle')}</p>
            <p className="text-xs text-muted-foreground/60">{t('workflows.emptyBody')}</p>

            <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t('workflows.tpl.heading')}
            </p>
            <div className="grid w-full max-w-2xl gap-2.5 sm:grid-cols-3">
              {templates.map(({ key, loop, tpl }) => (
                <button
                  key={key}
                  onClick={() => openTemplate(tpl)}
                  className="rounded-lg border border-border bg-card p-3 text-left hover:border-foreground/30 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold leading-snug">{tpl.name}</span>
                    {loop && <span className="text-amber-500 text-[11px]" title={t('workflows.gateEnable')}>↺</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{tpl.description}</p>
                  <p className="mt-2 text-[10px] text-muted-foreground/60">
                    {tpl.steps.map((s) => s.name).join(' → ')}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {workflows.map((wf) => {
              const u = usage.get(wf.id);
              return (
                <div key={wf.id} className="group rounded-lg border border-border bg-card p-3.5 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold leading-snug break-words min-w-0">{wf.name}</h3>
                    <div className="flex items-center gap-2 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button onClick={() => duplicate(wf)} className="-m-1 p-1 text-muted-foreground hover:text-foreground" title={t('workflows.duplicate')}>
                        <Copy className="size-3.5" />
                      </button>
                      <button onClick={() => openEdit(wf)} className="-m-1 p-1 text-muted-foreground hover:text-foreground" title={t('common.edit')}>
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => deleteWorkflow(wf.id)} className="-m-1 p-1 text-muted-foreground hover:text-rose-500" title={t('workflows.deleteWorkflow')}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {wf.description && (
                    <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{wf.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-1 mt-auto pt-1">
                    {wf.steps.map((step, i) => (
                      <span key={step.id} className="inline-flex items-center gap-1">
                        {i > 0 && <ArrowRight className="size-3 text-muted-foreground/40" />}
                        <StepPill step={step} />
                      </span>
                    ))}
                  </div>

                  {/* Usage + freshness: how much work runs through this template. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/60">
                    <span>{t('workflows.stepCount', { count: wf.steps.length })}</span>
                    {u && u.total > 0 && <span>· {t('workflows.usedCount', { count: u.total })}</span>}
                    {u && u.running > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">· {t('workflows.runningCount', { count: u.running })}</span>
                    )}
                    {u && u.blocked > 0 && (
                      <span className="text-rose-600 dark:text-rose-400">· {t('workflows.blockedCount', { count: u.blocked })}</span>
                    )}
                    {wf.updatedAt && <span>· {t('workflows.metaEdited', { time: timeAgo(wf.updatedAt) })}</span>}
                  </div>

                  <Button size="sm" variant="outline" onClick={() => setRunFor(wf)} className="gap-1.5 mt-1">
                    <Play className="size-3.5" />
                    {t('workflows.newTask')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <WorkflowBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        workflow={editing}
        template={template}
        onSave={(input) => {
          if (editing) updateWorkflow(editing.id, input);
          else createWorkflow(input);
        }}
      />

      <RunWorkflowDialog
        workflow={runFor}
        onOpenChange={(o) => !o && setRunFor(null)}
        onSubmit={(input) => { if (runFor) createTaskWith(runFor, input); }}
      />
    </div>
  );
}

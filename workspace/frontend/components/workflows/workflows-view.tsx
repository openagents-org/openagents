'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FlaskConical, Plus, RefreshCw, Waypoints } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { FeatureTourBanner } from '@/components/tours/feature-tour-banner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenuGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Workflow } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { WorkflowBuilderDialog } from './workflow-builder-dialog';
import { RunWorkflowDialog, type RunWorkflowInput } from './run-workflow-dialog';
import { WorkflowCard, type WorkflowUsage } from './workflow-card';
import { WorkflowsEmpty } from './workflows-empty';
import { useTemplates, type TemplateStarter } from './workflow-templates';

export function WorkflowsView() {
  const {
    workflows, refreshWorkflows, createWorkflow, updateWorkflow, deleteWorkflow,
    tasks, createTask, runTask, setCurrentSessionId,
  } = useWorkspace();
  const { openView } = useLayout();
  const t = useT();
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
    const map = new Map<string, WorkflowUsage>();
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

  const createTaskWith = async (wf: Workflow, input: RunWorkflowInput) => {
    const task = await createTask({
      title: input.title,
      description: input.description,
      workflowId: wf.id,
      knowledgeIds: input.knowledgeIds,
      fileIds: input.fileIds,
      status: 'backlog',
    });
    const started = await runTask(task.id);
    // Follow the run in its working thread.
    if (started.channelName) {
      setCurrentSessionId(started.channelName);
      openView('threads');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* The primary action sits beside the title, where the eye lands —
          not across the page in the header's right corner. */}
      <DetailHeader
        titleInHeader
        title={<div className="flex min-w-0 items-center gap-2">
          <Waypoints className="size-4 shrink-0 text-foreground" />
          <h2 className="truncate text-sm font-semibold">{t('views.workflows')}</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="ms-1 shrink-0">
                <Plus data-icon="inline-start" />
                {t('workflows.newWorkflow')}
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={openCreate}>{t('workflows.blank')}</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('workflows.tpl.heading')}</DropdownMenuLabel>
                {templates.map(({ key, loop, tpl }) => (
                  <DropdownMenuItem key={key} onClick={() => openTemplate(tpl)} className="flex-col items-start gap-0.5">
                    <span className="font-medium">
                      {tpl.name} {loop && <span className="text-warning">↺</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{tpl.steps.map((s) => s.name).join(' → ')}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={refreshWorkflows} aria-label={t('common.refresh')} className="text-muted-foreground">
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.refresh')}</TooltipContent>
        </Tooltip>
      </DetailHeader>

      <Alert role="note" className="rounded-none border-x-0 border-t-0 border-warning/30 bg-warning/10 text-warning">
        <FlaskConical />
        <AlertDescription className="text-xs text-warning">
          <p><span className="font-semibold">{t('workflows.experimentalTitle')}</span>{' '}{t('workflows.experimentalBody')}</p>
        </AlertDescription>
      </Alert>
      <FeatureTourBanner feature="workflows" />

      <div className="flex-1 overflow-y-auto">
        {workflows.length === 0 ? (
          <WorkflowsEmpty templates={templates} onPick={openTemplate} />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                usage={usage.get(wf.id)}
                onDuplicate={() => duplicate(wf)}
                onEdit={() => openEdit(wf)}
                onDelete={() => deleteWorkflow(wf.id)}
                onRun={() => setRunFor(wf)}
              />
            ))}
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

'use client';

import { useEffect, useState } from 'react';
import { Waypoints, Plus, RefreshCw, Trash2, Pencil, ArrowRight, User } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { DetailHeader } from '@/components/layout/app-header';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Button } from '@/components/ui/button';
import type { Workflow } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { WorkflowBuilderDialog } from './workflow-builder-dialog';

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
      {step.gate && <span className="text-amber-500" title={step.gate.condition}>↺</span>}
    </span>
  );
}

type TemplateStarter = { name: string; description: string; steps: Workflow['steps'] };

/** One-click starters shown on the empty page. Agents are intentionally left
 * unpicked — the builder opens prefilled and the user chooses who does what,
 * which doubles as a guided tour of steps and gates. */
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

export function WorkflowsView() {
  const { workflows, refreshWorkflows, createWorkflow, updateWorkflow, deleteWorkflow } = useWorkspace();
  const t = useT();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [template, setTemplate] = useState<TemplateStarter | null>(null);
  const templates = useTemplates(t);

  useEffect(() => {
    refreshWorkflows();
  }, [refreshWorkflows]);

  const openCreate = () => { setEditing(null); setTemplate(null); setBuilderOpen(true); };
  const openEdit = (wf: Workflow) => { setEditing(wf); setTemplate(null); setBuilderOpen(true); };
  const openTemplate = (tpl: TemplateStarter) => { setEditing(null); setTemplate(tpl); setBuilderOpen(true); };

  return (
    <div className="h-full flex flex-col">
      <DetailHeader
        title={<>
          <Waypoints className="size-4 text-foreground" />
          <h2 className="text-sm font-semibold">{t('views.workflows')}</h2>
        </>}
      >
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-3.5" />
          {t('workflows.newWorkflow')}
        </Button>
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
            {workflows.map((wf) => (
              <div key={wf.id} className="group rounded-lg border border-border bg-card p-3.5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-snug break-words min-w-0">{wf.name}</h3>
                  <div className="flex items-center gap-2 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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

                <p className="text-[10px] text-muted-foreground/60">{t('workflows.stepCount', { count: wf.steps.length })}</p>
              </div>
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
    </div>
  );
}

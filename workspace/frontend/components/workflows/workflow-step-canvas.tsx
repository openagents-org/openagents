'use client';

import { ArrowRight, BookOpen, CornerDownRight, Plus, RotateCcw, User } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/lib/i18n';
import type { WorkflowStep } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The workflow as a diagram: steps flow left → right, ending in an add-step node. */
export function WorkflowStepCanvas({
  steps,
  selectedId,
  onSelect,
  onAdd,
}: {
  steps: WorkflowStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const t = useT();
  const stepIndex = (id: string) => steps.findIndex((s) => s.id === id);

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4">
      <div className="flex min-w-max items-stretch gap-1">
        {steps.map((step, i) => {
          const isSel = step.id === selectedId;
          const isAgent = step.assignee.kind === 'agent';
          const gateTargetIdx = step.gate ? stepIndex(step.gate.target) : -1;
          const isLoop = gateTargetIdx > -1 && gateTargetIdx <= i;
          return (
            <div key={step.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                aria-pressed={isSel}
                className={cn(
                  'relative flex w-40 shrink-0 flex-col items-start gap-2 rounded-lg border bg-card p-2.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  isSel ? 'border-primary ring-2 ring-primary/30' : 'hover:border-foreground/30',
                )}
              >
                <div className="flex w-full items-center gap-1.5">
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{i + 1}</span>
                  <span className="truncate text-xs font-medium">{step.name || t('workflows.stepFallbackName', { n: i + 1 })}</span>
                  {step.knowledge_id && (
                    <BookOpen className="size-3 shrink-0 text-muted-foreground" aria-label={t('workflows.stepContext')} />
                  )}
                </div>
                <div className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                  {isAgent ? (
                    step.assignee.agent ? <AgentAvatar name={step.assignee.agent} size={16} /> : <User className="size-3.5 opacity-40" />
                  ) : (
                    <User className="size-3.5" />
                  )}
                  <span className="truncate">
                    {isAgent ? (step.assignee.agent || t('workflows.pickAgent')) : (step.assignee.human || t('workflows.human'))}
                  </span>
                </div>
                {step.gate && gateTargetIdx > -1 && (
                  <Badge variant={isLoop ? 'warning' : 'info'} title={step.gate.condition}>
                    {isLoop ? <RotateCcw /> : <CornerDownRight />}
                    {t('workflows.gateTarget')} #{gateTargetIdx + 1}
                  </Badge>
                )}
              </button>
              {i < steps.length - 1 && <ArrowRight className="size-4 shrink-0 text-muted-foreground/40" />}
            </div>
          );
        })}
        {/* Add-step node */}
        <div className="flex items-center gap-1">
          <ArrowRight className="size-4 shrink-0 text-muted-foreground/40" />
          <button
            type="button"
            onClick={onAdd}
            className="flex h-full min-h-19 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors outline-none hover:border-foreground/30 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus className="size-4" />
            {t('workflows.addStep')}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Plus, Trash2, ArrowRight, User, RotateCcw, CornerDownRight } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import type { Workflow, WorkflowStep } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Workflow | null;
  /** Prefill for a NEW workflow (template starter) — used when workflow is null. */
  template?: { name: string; description: string; steps: WorkflowStep[] } | null;
  onSave: (input: { name: string; description: string; steps: WorkflowStep[]; maxIterations: number }) => void;
}

function newId(): string {
  try { return crypto.randomUUID(); } catch { return `step-${Math.floor(performance.now() * 1000)}`; }
}

function blankStep(): WorkflowStep {
  return { id: newId(), name: '', instruction: '', assignee: { kind: 'agent', agent: null } };
}

export function WorkflowBuilderDialog({ open, onOpenChange, workflow, template, onSave }: Props) {
  const t = useT();
  const { agents } = useWorkspace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxIterations, setMaxIterations] = useState(5);
  const [steps, setSteps] = useState<WorkflowStep[]>([blankStep()]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Precedence: an existing workflow (edit) > a template starter (create).
    const source = workflow ?? template ?? null;
    const initial = source && source.steps.length
      ? source.steps.map((s) => ({ ...s }))
      : [blankStep()];
    setName(source?.name ?? '');
    setDescription(source?.description ?? '');
    setMaxIterations(workflow?.maxIterations ?? 5);
    setSteps(initial);
    setSelectedId(initial[0].id);
  }, [open, workflow, template]);

  const selected = useMemo(() => steps.find((s) => s.id === selectedId) || null, [steps, selectedId]);
  const stepIndex = (id: string) => steps.findIndex((s) => s.id === id);

  const patchStep = (id: string, patch: Partial<WorkflowStep>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const patchAssignee = (id: string, patch: Partial<WorkflowStep['assignee']>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, assignee: { ...s.assignee, ...patch } } : s)));

  const addStep = () => {
    const s = blankStep();
    setSteps((prev) => [...prev, s]);
    setSelectedId(s.id);
  };
  const removeStep = (id: string) => {
    setSteps((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id)
        // Drop any dangling gate targets that pointed at the removed step.
        .map((s) => (s.gate?.target === id ? { ...s, gate: undefined } : s));
      setSelectedId(next[Math.max(0, idx - 1)].id);
      return next;
    });
  };

  const canSave =
    name.trim().length > 0 &&
    steps.length > 0 &&
    steps.every((s) => s.instruction.trim() && (s.assignee.kind === 'human' || s.assignee.agent));

  const handleSave = () => {
    if (!canSave) return;
    const cleaned = steps.map((s, i) => ({
      ...s,
      name: s.name.trim() || t('workflows.stepFallbackName', { n: i + 1 }),
      instruction: s.instruction.trim(),
    }));
    onSave({ name: name.trim(), description: description.trim(), steps: cleaned, maxIterations });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader className="px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">
            {workflow ? t('workflows.editTitle') : t('workflows.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4 px-7 py-2">
          {/* Meta */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workflows.namePlaceholder')} autoFocus className="flex-1" />
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">{t('workflows.maxIterations')}</label>
              <Input
                type="number" min={1} max={50} value={maxIterations}
                onChange={(e) => setMaxIterations(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="w-16 h-8"
              />
            </div>
          </div>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('workflows.descriptionPlaceholder')} rows={2} />

          {/* ── Diagram canvas: steps flow left → right ── */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4 overflow-x-auto">
            <div className="flex items-stretch gap-1 min-w-max">
              {steps.map((step, i) => {
                const isSel = step.id === selectedId;
                const isAgent = step.assignee.kind === 'agent';
                const gateTargetIdx = step.gate ? stepIndex(step.gate.target) : -1;
                const isLoop = gateTargetIdx > -1 && gateTargetIdx <= i;
                return (
                  <div key={step.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedId(step.id)}
                      className={cn(
                        'relative w-40 shrink-0 rounded-lg border bg-card p-2.5 text-left transition-colors',
                        isSel ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-foreground/30',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{i + 1}</span>
                        <span className="text-xs font-medium truncate">{step.name || t('workflows.stepFallbackName', { n: i + 1 })}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
                        <span
                          className={cn(
                            'mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                            isLoop ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
                          )}
                          title={step.gate.condition}
                        >
                          {isLoop ? <RotateCcw className="size-2.5" /> : <CornerDownRight className="size-2.5" />}
                          {t('workflows.gateTarget')} #{gateTargetIdx + 1}
                        </span>
                      )}
                    </button>
                    {i < steps.length - 1 && <ArrowRight className="size-4 text-muted-foreground/40 shrink-0" />}
                  </div>
                );
              })}
              {/* Add-step node */}
              <div className="flex items-center gap-1">
                <ArrowRight className="size-4 text-muted-foreground/40 shrink-0" />
                <button
                  type="button"
                  onClick={addStep}
                  className="flex h-full min-h-[76px] w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground/60 hover:border-border hover:text-muted-foreground transition-colors"
                >
                  <Plus className="size-4" />
                  {t('workflows.addStep')}
                </button>
              </div>
            </div>
          </div>

          {/* ── Selected step editor ── */}
          {selected && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('workflows.stepFallbackName', { n: stepIndex(selected.id) + 1 })}
                </span>
                <button
                  onClick={() => removeStep(selected.id)}
                  disabled={steps.length <= 1}
                  className="text-muted-foreground hover:text-rose-500 disabled:opacity-30 transition-colors"
                  title={t('workflows.deleteStep')}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              <Input
                value={selected.name}
                onChange={(e) => patchStep(selected.id, { name: e.target.value })}
                placeholder={t('workflows.stepName')}
                className="h-8"
              />
              <Textarea
                value={selected.instruction}
                onChange={(e) => patchStep(selected.id, { instruction: e.target.value })}
                placeholder={t('workflows.stepInstructionPlaceholder')}
                rows={2}
              />

              {/* Assignee */}
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border border-input overflow-hidden text-xs">
                  {(['agent', 'human'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => patchAssignee(selected.id, { kind: k })}
                      className={cn('px-2.5 py-1 transition-colors',
                        selected.assignee.kind === k ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/50')}
                    >
                      {t(`workflows.${k}`)}
                    </button>
                  ))}
                </div>
                {selected.assignee.kind === 'agent' ? (
                  <Select value={selected.assignee.agent || ''} onValueChange={(v) => patchAssignee(selected.id, { agent: v })}>
                    <SelectTrigger className="h-8 flex-1"><SelectValue placeholder={t('workflows.pickAgent')} /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => <SelectItem key={a.agentName} value={a.agentName}>{a.agentName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={selected.assignee.human || ''}
                    onChange={(e) => patchAssignee(selected.id, { human: e.target.value })}
                    placeholder={t('workflows.humanNamePlaceholder')}
                    className="h-8 flex-1"
                  />
                )}
              </div>

              {/* Gate */}
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!selected.gate}
                  onChange={(e) =>
                    patchStep(selected.id, e.target.checked
                      ? { gate: { condition: '', target: steps[0].id } }
                      : { gate: undefined })
                  }
                />
                {t('workflows.gateEnable')}
              </label>
              {selected.gate && (
                <div className="space-y-2 rounded-md bg-muted/40 p-2">
                  <p className="text-[11px] text-muted-foreground/70">{t('workflows.gateHint')}</p>
                  <Input
                    value={selected.gate.condition}
                    onChange={(e) => patchStep(selected.id, { gate: { ...selected.gate!, condition: e.target.value } })}
                    placeholder={t('workflows.gateConditionPlaceholder')}
                    className="h-8"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{t('workflows.gateTarget')}</span>
                    <Select value={selected.gate.target} onValueChange={(v) => patchStep(selected.id, { gate: { ...selected.gate!, target: v } })}>
                      <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {steps.map((s, si) => (
                          <SelectItem key={s.id} value={s.id}>#{si + 1} {s.name || t('workflows.stepFallbackName', { n: si + 1 })}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter className="px-7 pt-4 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleSave} disabled={!canSave}>
            {workflow ? t('workflows.save') : t('workflows.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

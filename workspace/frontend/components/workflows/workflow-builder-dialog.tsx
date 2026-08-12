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
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import type { Workflow, WorkflowStep } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing workflow to edit, or null to create. */
  workflow: Workflow | null;
  onSave: (input: { name: string; description: string; steps: WorkflowStep[]; maxIterations: number }) => void;
}

// A local step id for freshly-added steps (the backend re-issues stable ids).
function newId(): string {
  try { return crypto.randomUUID(); } catch { return `step-${Math.floor(performance.now() * 1000)}`; }
}

function blankStep(): WorkflowStep {
  return { id: newId(), name: '', instruction: '', assignee: { kind: 'agent', agent: null } };
}

export function WorkflowBuilderDialog({ open, onOpenChange, workflow, onSave }: Props) {
  const t = useT();
  const { agents } = useWorkspace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxIterations, setMaxIterations] = useState(5);
  const [steps, setSteps] = useState<WorkflowStep[]>([blankStep()]);

  useEffect(() => {
    if (!open) return;
    if (workflow) {
      setName(workflow.name);
      setDescription(workflow.description);
      setMaxIterations(workflow.maxIterations);
      setSteps(workflow.steps.length ? workflow.steps.map((s) => ({ ...s })) : [blankStep()]);
    } else {
      setName('');
      setDescription('');
      setMaxIterations(5);
      setSteps([blankStep()]);
    }
  }, [open, workflow]);

  const patchStep = (id: string, patch: Partial<WorkflowStep>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const patchAssignee = (id: string, patch: Partial<WorkflowStep['assignee']>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, assignee: { ...s.assignee, ...patch } } : s)));

  const addStep = () => setSteps((prev) => [...prev, blankStep()]);
  const removeStep = (id: string) => setSteps((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">
            {workflow ? t('workflows.editTitle') : t('workflows.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4 px-7 py-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workflows.namePlaceholder')} autoFocus />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('workflows.descriptionPlaceholder')} rows={2} />

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">{t('workflows.maxIterations')}</label>
            <Input
              type="number"
              min={1}
              max={50}
              value={maxIterations}
              onChange={(e) => setMaxIterations(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="w-20 h-8"
            />
            <span className="text-[11px] text-muted-foreground/70">{t('workflows.maxIterationsHint')}</span>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('workflows.steps')}</label>
            </div>

            {steps.map((step, i) => (
              <div key={step.id} className="rounded-lg border border-border bg-card p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <GripVertical className="size-3.5 text-muted-foreground/40 shrink-0" />
                  <span className="text-[11px] font-semibold text-muted-foreground w-10">#{i + 1}</span>
                  <Input
                    value={step.name}
                    onChange={(e) => patchStep(step.id, { name: e.target.value })}
                    placeholder={t('workflows.stepName')}
                    className="h-8"
                  />
                  <button
                    onClick={() => removeStep(step.id)}
                    disabled={steps.length <= 1}
                    className="shrink-0 text-muted-foreground hover:text-rose-500 disabled:opacity-30 transition-colors"
                    title={t('workflows.deleteStep')}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <Textarea
                  value={step.instruction}
                  onChange={(e) => patchStep(step.id, { instruction: e.target.value })}
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
                        onClick={() => patchAssignee(step.id, { kind: k })}
                        className={cn(
                          'px-2.5 py-1 transition-colors',
                          step.assignee.kind === k ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        {t(`workflows.${k}`)}
                      </button>
                    ))}
                  </div>
                  {step.assignee.kind === 'agent' ? (
                    <Select
                      value={step.assignee.agent || ''}
                      onValueChange={(v) => patchAssignee(step.id, { agent: v })}
                    >
                      <SelectTrigger className="h-8 flex-1"><SelectValue placeholder={t('workflows.pickAgent')} /></SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => (
                          <SelectItem key={a.agentName} value={a.agentName}>{a.agentName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={step.assignee.human || ''}
                      onChange={(e) => patchAssignee(step.id, { human: e.target.value })}
                      placeholder={t('workflows.humanNamePlaceholder')}
                      className="h-8 flex-1"
                    />
                  )}
                </div>

                {/* Gate */}
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!step.gate}
                    onChange={(e) =>
                      patchStep(step.id, e.target.checked
                        ? { gate: { condition: '', target: steps[0].id } }
                        : { gate: undefined })
                    }
                  />
                  {t('workflows.gateEnable')}
                </label>
                {step.gate && (
                  <div className="space-y-2 rounded-md bg-muted/40 p-2">
                    <p className="text-[11px] text-muted-foreground/70">{t('workflows.gateHint')}</p>
                    <Input
                      value={step.gate.condition}
                      onChange={(e) => patchStep(step.id, { gate: { ...step.gate!, condition: e.target.value } })}
                      placeholder={t('workflows.gateConditionPlaceholder')}
                      className="h-8"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">{t('workflows.gateTarget')}</span>
                      <Select
                        value={step.gate.target}
                        onValueChange={(v) => patchStep(step.id, { gate: { ...step.gate!, target: v } })}
                      >
                        <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {steps.map((s, si) => (
                            <SelectItem key={s.id} value={s.id}>
                              #{si + 1} {s.name || t('workflows.stepFallbackName', { n: si + 1 })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={addStep} className="gap-1.5 w-full">
              <Plus className="size-3.5" />
              {t('workflows.addStep')}
            </Button>
          </div>
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

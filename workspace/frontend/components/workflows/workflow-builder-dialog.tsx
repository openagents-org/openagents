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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Workflow, WorkflowStep } from '@/lib/types';
import { WorkflowStepCanvas } from './workflow-step-canvas';
import { WorkflowStepEditor } from './workflow-step-editor';

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
        <DialogHeader>
          <DialogTitle>
            {workflow ? t('workflows.editTitle') : t('workflows.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          <FieldGroup className="gap-4">
            {/* Meta */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workflows.namePlaceholder')}
                aria-label={t('workflows.namePlaceholder')}
                autoFocus
                className="flex-1"
              />
              <Field orientation="horizontal" className="w-auto shrink-0">
                <FieldLabel htmlFor="workflow-max-iterations" className="text-xs whitespace-nowrap text-muted-foreground">
                  {t('workflows.maxIterations')}
                </FieldLabel>
                <Input
                  id="workflow-max-iterations"
                  type="number" min={1} max={50} value={maxIterations}
                  onChange={(e) => setMaxIterations(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className="w-16"
                />
              </Field>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('workflows.descriptionPlaceholder')}
              aria-label={t('workflows.descriptionPlaceholder')}
              rows={2}
            />

            <WorkflowStepCanvas steps={steps} selectedId={selectedId} onSelect={setSelectedId} onAdd={addStep} />

            {selected && (
              <WorkflowStepEditor
                step={selected}
                index={stepIndex(selected.id)}
                steps={steps}
                onPatch={(patch) => patchStep(selected.id, patch)}
                onPatchAssignee={(patch) => patchAssignee(selected.id, patch)}
                onRemove={() => removeStep(selected.id)}
              />
            )}
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
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

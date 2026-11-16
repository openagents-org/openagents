'use client';

import { BookOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { WorkflowStep } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';

// Radix Select reserves "" for "nothing selected"; the no-context choice
// needs its own value, unwrapped back to undefined on change.
const NO_KNOWLEDGE = '__none__';

/** Everything about the selected step: name, instruction, who does it, context and gate. */
export function WorkflowStepEditor({
  step,
  index,
  steps,
  onPatch,
  onPatchAssignee,
  onRemove,
}: {
  step: WorkflowStep;
  index: number;
  steps: WorkflowStep[];
  onPatch: (patch: Partial<WorkflowStep>) => void;
  onPatchAssignee: (patch: Partial<WorkflowStep['assignee']>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { agents, knowledge } = useWorkspace();
  const gateId = `workflow-step-gate-${step.id}`;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
          {t('workflows.stepFallbackName', { n: index + 1 })}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onRemove}
            disabled={steps.length <= 1}
            title={t('workflows.deleteStep')}
            aria-label={t('workflows.deleteStep')}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-3">
          <Input
            value={step.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder={t('workflows.stepName')}
            aria-label={t('workflows.stepName')}
          />
          <Textarea
            value={step.instruction}
            onChange={(e) => onPatch({ instruction: e.target.value })}
            placeholder={t('workflows.stepInstructionPlaceholder')}
            aria-label={t('workflows.stepInstructionPlaceholder')}
            rows={2}
          />

          {/* Assignee */}
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={step.assignee.kind}
              onValueChange={(v) => { if (v) onPatchAssignee({ kind: v as WorkflowStep['assignee']['kind'] }); }}
            >
              <ToggleGroupItem value="agent">{t('workflows.agent')}</ToggleGroupItem>
              <ToggleGroupItem value="human">{t('workflows.human')}</ToggleGroupItem>
            </ToggleGroup>
            {step.assignee.kind === 'agent' ? (
              <Select value={step.assignee.agent || ''} onValueChange={(v) => onPatchAssignee({ agent: v })}>
                <SelectTrigger className="flex-1"><SelectValue placeholder={t('workflows.pickAgent')} /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {agents.map((a) => <SelectItem key={a.agentName} value={a.agentName}>{agentLabel(a)}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={step.assignee.human || ''}
                onChange={(e) => onPatchAssignee({ human: e.target.value })}
                placeholder={t('workflows.humanNamePlaceholder')}
                aria-label={t('workflows.humanNamePlaceholder')}
                className="flex-1"
              />
            )}
          </div>

          {/* Per-step context: one shared-knowledge entry, cited as
              @knowledge:<slug> when the engine delivers this step. */}
          {knowledge.length > 0 && (
            <div className="flex items-center gap-2">
              <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
              <Select
                value={step.knowledge_id || NO_KNOWLEDGE}
                onValueChange={(v) => onPatch({ knowledge_id: v === NO_KNOWLEDGE ? undefined : v })}
              >
                <SelectTrigger className="flex-1" aria-label={t('workflows.stepContext')}>
                  <SelectValue placeholder={t('workflows.stepContext')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_KNOWLEDGE}>{t('workflows.stepContextNone')}</SelectItem>
                    {knowledge.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Gate */}
          <Field orientation="horizontal">
            <Checkbox
              id={gateId}
              checked={!!step.gate}
              onCheckedChange={(checked) =>
                onPatch(checked === true ? { gate: { condition: '', target: steps[0].id } } : { gate: undefined })
              }
            />
            <FieldLabel htmlFor={gateId} className="text-xs font-normal text-muted-foreground">
              {t('workflows.gateEnable')}
            </FieldLabel>
          </Field>
          {step.gate && (
            <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2">
              <FieldDescription className="text-xs">{t('workflows.gateHint')}</FieldDescription>
              <Input
                value={step.gate.condition}
                onChange={(e) => onPatch({ gate: { ...step.gate!, condition: e.target.value } })}
                placeholder={t('workflows.gateConditionPlaceholder')}
                aria-label={t('workflows.gateConditionPlaceholder')}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('workflows.gateTarget')}</span>
                <Select value={step.gate.target} onValueChange={(v) => onPatch({ gate: { ...step.gate!, target: v } })}>
                  <SelectTrigger className="flex-1" aria-label={t('workflows.gateTarget')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {steps.map((s, si) => (
                        <SelectItem key={s.id} value={s.id}>#{si + 1} {s.name || t('workflows.stepFallbackName', { n: si + 1 })}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

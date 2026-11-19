'use client';

import { BookOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { WithTooltip } from '@/components/ui/with-tooltip';
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
  const id = (field: string) => `workflow-step-${step.id}-${field}`;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {t('workflows.stepFallbackName', { n: index + 1 })}
        </CardTitle>
        <CardAction>
          <WithTooltip label={t('workflows.deleteStep')}><Button
                variant="ghost"
                size="icon-xs"
                onClick={onRemove}
                disabled={steps.length <= 1}
                aria-label={t('workflows.deleteStep')}
                className="text-muted-foreground"
              >
                <Trash2 />
              </Button></WithTooltip>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor={id('name')}>{t('workflows.stepName')}</FieldLabel>
            <Input
              id={id('name')}
              value={step.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              placeholder={t('workflows.stepName')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={id('instruction')}>{t('workflows.stepInstruction')}</FieldLabel>
            <Textarea
              id={id('instruction')}
              value={step.instruction}
              onChange={(e) => onPatch({ instruction: e.target.value })}
              placeholder={t('workflows.stepInstructionPlaceholder')}
              rows={2}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={id('assignee')}>{t('workflows.assignee')}</FieldLabel>
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                aria-label={t('workflows.assignee')}
                value={step.assignee.kind}
                onValueChange={(v) => { if (v) onPatchAssignee({ kind: v as WorkflowStep['assignee']['kind'] }); }}
              >
                <ToggleGroupItem value="agent">{t('workflows.agent')}</ToggleGroupItem>
                <ToggleGroupItem value="human">{t('workflows.human')}</ToggleGroupItem>
              </ToggleGroup>
              {step.assignee.kind === 'agent' ? (
                <Select value={step.assignee.agent || ''} onValueChange={(v) => onPatchAssignee({ agent: v })}>
                  <SelectTrigger id={id('assignee')} className="flex-1"><SelectValue placeholder={t('workflows.pickAgent')} /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {agents.map((a) => <SelectItem key={a.agentName} value={a.agentName}>{agentLabel(a)}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id('assignee')}
                  value={step.assignee.human || ''}
                  onChange={(e) => onPatchAssignee({ human: e.target.value })}
                  placeholder={t('workflows.humanNamePlaceholder')}
                  className="flex-1"
                />
              )}
            </div>
          </Field>

          {/* Per-step context: one shared-knowledge entry, cited as
              @knowledge:<slug> when the engine delivers this step. */}
          {knowledge.length > 0 && (
            <Field>
              <FieldLabel htmlFor={id('context')}><BookOpen className="size-3.5 text-muted-foreground" />{t('workflows.stepContext')}</FieldLabel>
              <Select
                value={step.knowledge_id || NO_KNOWLEDGE}
                onValueChange={(v) => onPatch({ knowledge_id: v === NO_KNOWLEDGE ? undefined : v })}
              >
                <SelectTrigger id={id('context')} className="w-full">
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
            </Field>
          )}

          {/* Gate */}
          <Field orientation="horizontal">
            <Checkbox
              id={id('gate')}
              checked={!!step.gate}
              onCheckedChange={(checked) =>
                onPatch(checked === true ? { gate: { condition: '', target: steps[0].id } } : { gate: undefined })
              }
            />
            <FieldLabel htmlFor={id('gate')} className="font-normal">
              {t('workflows.gateEnable')}
            </FieldLabel>
          </Field>
          {step.gate && (
            <FieldGroup className="gap-3 rounded-md bg-muted/50 p-2">
              <FieldDescription>{t('workflows.gateHint')}</FieldDescription>
              <Field>
                <FieldLabel htmlFor={id('condition')}>{t('workflows.gateCondition')}</FieldLabel>
                <Input
                  id={id('condition')}
                  value={step.gate.condition}
                  onChange={(e) => onPatch({ gate: { ...step.gate!, condition: e.target.value } })}
                  placeholder={t('workflows.gateConditionPlaceholder')}
                />
              </Field>
              <Field orientation="horizontal">
                <FieldLabel htmlFor={id('target')} className="shrink-0">{t('workflows.gateTarget')}</FieldLabel>
                <Select value={step.gate.target} onValueChange={(v) => onPatch({ gate: { ...step.gate!, target: v } })}>
                  <SelectTrigger id={id('target')} className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {steps.map((s, si) => (
                        <SelectItem key={s.id} value={s.id}>#{si + 1} {s.name || t('workflows.stepFallbackName', { n: si + 1 })}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

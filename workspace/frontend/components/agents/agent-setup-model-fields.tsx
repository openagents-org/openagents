'use client';
import React from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectGroup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AUTO_MODEL, CUSTOM_MODEL, modelProblem } from './agent-setup-types';
import type { AgentSetupForm } from './use-agent-setup-form';

/** Which API a codex agent on a custom endpoint speaks. */
export function CodexModeField({ form }: { form: AgentSetupForm }) {
  const t = useT();
  const { codexWireApi, setCodexWireApi, creds } = form;
  return (
    <Field>
      <FieldLabel>{t('connect.codexMode')}</FieldLabel>
      <Select value={codexWireApi} onValueChange={(v) => setCodexWireApi(v as 'responses' | 'chat')}>
        <SelectTrigger aria-label={t('connect.codexMode')} className="h-10 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup><SelectItem value="responses">{t('connect.codexModeResponses')}</SelectItem>
          <SelectItem value="chat">{t('connect.codexModeChat')}</SelectItem></SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription className={cn(codexWireApi === 'chat' && 'text-warning')}>
        {t(codexWireApi === 'chat' ? 'connect.codexModeChatHint' : 'connect.codexModeResponsesHint')}
      </FieldDescription>
      {codexWireApi === 'responses' && !creds.supportsCodexMode && <FieldError>{t('connect.codexModeUpdate')}</FieldError>}
    </Field>
  );
}

/** Model — curated dropdown, or the models the device's sign-in offers. */
export function CuratedModelField({ form, pickerModels }: { form: AgentSetupForm; pickerModels: { id: string; label: string }[] }) {
  const t = useT();
  const { selected, selectedEntry, model, setModel, customModel, setCustomModel, creds } = form;
  return (
    <Field>
      <FieldLabel>{t('connect.nodeAgentModelOptional')}</FieldLabel>
      <Select
        value={selected === 'pi' && customModel ? CUSTOM_MODEL : model.trim() || AUTO_MODEL}
        onValueChange={(v) => {
          if (selected === 'pi' && v === CUSTOM_MODEL) { setCustomModel(true); return; }
          setCustomModel(false);
          setModel(v === AUTO_MODEL ? '' : v);
        }}
      >
        <SelectTrigger aria-label={t('connect.nodeModel')} className="h-10 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup><SelectItem value={AUTO_MODEL}>{t('connect.nodeModelAuto')}</SelectItem>
          {pickerModels.map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
          ))}
          {creds.unlistedModel && (
            <SelectItem value={creds.unlistedModel}>{t('connect.nodeModelUnlisted', { model: creds.unlistedModel })}</SelectItem>
          )}
          {selected === 'pi' && <SelectItem value={CUSTOM_MODEL}>{t('connect.byokCustomModel')}</SelectItem>}</SelectGroup>
        </SelectContent>
      </Select>
      {selected === 'pi' && customModel && (
        <Input
          data-testid="agent-setup-custom-model"
          aria-label={t('connect.byokCustomModel')}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={t('connect.byokCustomModel')}
          className="h-10 font-mono text-sm"
        />
      )}
      {creds.accountModels && (
        <FieldDescription data-testid="agent-setup-account-models">
          {t(selected === 'pi' ? 'connect.nodeModelDeviceHint' : 'connect.nodeModelAccountHint', { label: selectedEntry?.label || selected || '' })}
        </FieldDescription>
      )}
    </Field>
  );
}

/**
 * Model for the add wizard: the models the device's own CLI lists, "Auto"
 * for the agent's default, and "Custom model" for an id the list leaves out.
 * With nothing listed (an older device, or a CLI that would not say) it is a
 * plain text field.
 */
export function DeviceModelField({ form, deviceModels }: { form: AgentSetupForm; deviceModels: { id: string; label?: string }[] }) {
  const t = useT();
  // The form's own flag, so picking another agent type resets it with the rest.
  const { model, setModel, customModel, setCustomModel } = form;
  const listed = deviceModels.some((m) => m.id === model.trim());
  // A typed id the list does not carry stays on the text field, not "Auto",
  // also when the device's list only arrives after it was typed.
  const custom = customModel || (!!model.trim() && !listed);
  // A display name typed in place of its id is offered the id it stands for.
  const problem = modelProblem(model, deviceModels);
  const invalid = !!problem;
  const input = (
    <Input id="setup-model" data-testid="agent-setup-model" value={model} onChange={(event) => setModel(event.target.value)}
      placeholder={deviceModels.length ? t('agentSetup.customModelPlaceholder', { example: deviceModels[0].id }) : t('connect.nodeModelAuto')} autoComplete="off" spellCheck={false}
      aria-label={deviceModels.length ? t('connect.byokCustomModel') : undefined} aria-invalid={invalid || undefined} className={cn('h-10 text-sm', deviceModels.length > 0 && 'font-mono')} />
  );
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={deviceModels.length ? 'setup-device-model' : 'setup-model'}>{t('connect.nodeAgentModelOptional')}</FieldLabel>
      {deviceModels.length > 0 && (
        <Select
          value={custom ? CUSTOM_MODEL : listed ? model.trim() : AUTO_MODEL}
          onValueChange={(v) => {
            setCustomModel(v === CUSTOM_MODEL);
            setModel(v === AUTO_MODEL || v === CUSTOM_MODEL ? '' : v);
          }}
        >
          <SelectTrigger id="setup-device-model" data-testid="agent-setup-device-model" className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={AUTO_MODEL}>{t('connect.nodeModelAuto')}</SelectItem>
              {deviceModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.label || m.id}</SelectItem>
              ))}
              <SelectItem value={CUSTOM_MODEL}>{t('connect.byokCustomModel')}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      {(custom || deviceModels.length === 0) && input}
      {problem?.kind === 'label' ? (
        <FieldError data-testid="agent-setup-model-error" className="flex flex-wrap items-center gap-2">
          {t('agentSetup.modelIsLabel', { id: problem.id })}
          <Button type="button" size="xs" variant="outline" onClick={() => { setCustomModel(false); setModel(problem.id); }}>{t('agentSetup.useModelId', { id: problem.id })}</Button>
        </FieldError>
      ) : problem && <FieldError data-testid="agent-setup-model-error">{t('agentSetup.modelIdInvalid')}</FieldError>}
      <FieldDescription>{t(deviceModels.length ? 'agentSetup.deviceModelsHint' : 'agentSetup.modelHint')}</FieldDescription>
    </Field>
  );
}

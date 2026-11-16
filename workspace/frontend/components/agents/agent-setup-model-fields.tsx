'use client';
import React from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectGroup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AUTO_MODEL, CUSTOM_MODEL } from './agent-setup-types';
import type { AgentSetupForm } from './use-agent-setup-form';

/** Which API a codex agent on a custom endpoint speaks. */
export function CodexModeField({ form }: { form: AgentSetupForm }) {
  const t = useT();
  const { codexWireApi, setCodexWireApi, creds } = form;
  return (
    <Field>
      <FieldLabel>{t('connect.codexMode')}</FieldLabel>
      <Select value={codexWireApi} onValueChange={(v) => setCodexWireApi(v as 'responses' | 'chat')}>
        <SelectTrigger aria-label={t('connect.codexMode')}><SelectValue /></SelectTrigger>
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

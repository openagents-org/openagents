'use client';
import React from 'react';
import { Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import type { AgentSetupProps } from './agent-setup-types';
import type { AgentSetupForm } from './use-agent-setup-form';

/** The agent's own credential fields (CodeArts AK/SK), sent as `config`. */
export function NativeCredentialFields({ form, includeModel = true }: { form: AgentSetupForm; includeModel?: boolean }) {
  const t = useT();
  const { isEdit, selectedStatus, nativeCreds, nativeValues, setNativeValues, creds, model, setModel } = form;
  return (
    <FieldGroup className="gap-3">
      {nativeCreds.map((f) => (
        <Field key={f.name}>
          <FieldLabel className="font-mono">
            {f.name}{!isEdit && selectedStatus !== 'ready' && <span className="text-destructive"> *</span>}
          </FieldLabel>
          <Input
            aria-label={f.name}
            value={nativeValues[f.name] || ''}
            onChange={(e) => setNativeValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
            type="password"
            autoComplete="off"
            className="h-10 text-sm"
          />
          {f.description && <FieldDescription>{f.description}</FieldDescription>}
        </Field>
      ))}
      <FieldDescription>{t('connect.nodeNativeCredsHint')}</FieldDescription>
      {includeModel && !creds.pickerModels && (
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('connect.nodeAgentModelOptional')} className="h-10 text-sm" />
      )}
    </FieldGroup>
  );
}

/** An optional key, endpoint and model, folded away until asked for. */
export function OptionalCredentialFields({ form, editAgent }: { form: AgentSetupForm } & Pick<AgentSetupProps, 'editAgent'>) {
  const t = useT();
  const { isEdit, showCreds, setShowCreds, apiKey, setApiKey, baseUrl, setBaseUrl, model, setModel, detail, creds, modelError, modelFieldRef } = form;
  if (!showCreds) {
    return (
      <Button variant="link" size="xs" className="h-auto self-start px-0 text-muted-foreground" onClick={() => setShowCreds(true)}>
        <Key data-icon="inline-start" />{t('connect.nodeCredsOptional')}
      </Button>
    );
  }
  const customModelLabel = baseUrl.trim() ? t('connect.nodeCustomModelRequired') : t('connect.nodeAgentModelOptional');
  return (
    <Field>
      <FieldLabel>{t('connect.nodeCredsOptional')}</FieldLabel>
      <Input
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={isEdit && editAgent?.apiKeyMasked ? editAgent.apiKeyMasked : t('connect.nodeAgentKeyOptional')}
        type="password"
        className="h-10 text-sm"
      />
      {isEdit && editAgent?.apiKeyMasked && (
        <FieldDescription>{t('connect.nodeKeyConfiguredHint', { masked: editAgent.apiKeyMasked })}</FieldDescription>
      )}
      {/* No custom endpoint for provider-locked agents — as dead an
          option as a relay key. */}
      {!detail?.provider_locked && (
        <>
          <Input
            value={baseUrl}
            onChange={(e) => {
              if (!baseUrl.trim() && e.target.value.trim()) setModel('');
              setBaseUrl(e.target.value);
            }}
            placeholder={t('connect.nodeAgentBaseUrlOptional')}
            className="h-10 font-mono text-sm"
          />
          <FieldDescription>{t('connect.nodeAgentBaseUrlHint')}</FieldDescription>
        </>
      )}
      {/* Custom endpoint set → the curated model ids don't apply; take
          the endpoint's own model id as free text instead. */}
      {(!creds.pickerModels || !!baseUrl.trim()) && (
        <div ref={modelFieldRef} className="flex flex-col gap-1.5">
          <Input data-testid="agent-setup-model" aria-label={customModelLabel} aria-invalid={!!modelError} value={model} onChange={(e) => setModel(e.target.value)} placeholder={customModelLabel} className="h-10 text-sm" />
          {modelError && <FieldError data-testid="agent-setup-model-error">{modelError}</FieldError>}
        </div>
      )}
    </Field>
  );
}

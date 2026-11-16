'use client';
import React from 'react';
import { CheckCircle2, Key, Plus, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectGroup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { DEVICE_KEY, KEEP_CURRENT, NO_ACCESS, SIGN_IN, type AgentSetupProps } from './agent-setup-types';
import { ByokModelPicker } from './agent-setup-byok-models';
import type { AgentSetupForm } from './use-agent-setup-form';

/** Bring-your-own-provider: saved model access → model, live-verified. */
export function ByokSection({ form, node, editAgent, extensions }: { form: AgentSetupForm } & Pick<AgentSetupProps, 'node' | 'editAgent' | 'extensions'>) {
  const t = useT();
  const { isEdit, selected, selectedEntry, selectedStatus, editOnKey, byokProtocol, byokState: b, creds: c, runtimeByType, detecting, reDetect } = form;
  const label = selectedEntry?.label || selected || '';
  const reDetectButton = (
    <Button variant="link" size="xs" className="h-auto px-0" onClick={reDetect} disabled={detecting}>
      <RefreshCw data-icon="inline-start" className={cn(detecting && 'animate-spin')} />
      {detecting ? t('connect.nodeDetecting') : t('connect.nodeReDetect')}
    </Button>
  );
  const pickCredential = (v: string) => {
    c.setSignInPick(v === SIGN_IN);
    c.setUseDeviceKey(v === DEVICE_KEY);
    c.setCredsTouched(true);
    if (v === KEEP_CURRENT) {
      c.setKeepCurrent(true);
      b.setAccessId('');
      form.setModel(editAgent?.model ?? '');
      b.setCustomModel(false);
      b.resetChecks();
      return;
    }
    c.setKeepCurrent(false);
    b.pickAccess([NO_ACCESS, SIGN_IN, DEVICE_KEY].includes(v) ? '' : v);
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <Key className="size-3.5 text-muted-foreground" />{t('connect.byokTitle')}
          {c.keyOnly && <span data-testid="agent-setup-title-required" className="text-destructive">*</span>}
        </span>
        {b.test.state === 'ok' && (
          <Badge variant="success"><CheckCircle2 data-icon="inline-start" />{t('connect.byokVerifiedShort')}</Badge>
        )}
      </div>

      {/* Add-new + saved model access */}
      <div ref={c.credsFieldRef} className="flex gap-2">
        <Button variant="outline" onClick={() => b.setShowAccessDialog(true)} className="h-10 shrink-0 sm:min-w-48">
          <Plus data-icon="inline-start" />{t('connect.byokAddAccess')}
        </Button>
        <Select
          value={b.accessId || (c.keepCurrent ? KEEP_CURRENT : c.onSignIn ? SIGN_IN : c.onDeviceKey ? DEVICE_KEY : NO_ACCESS)}
          onValueChange={pickCredential}
        >
          <SelectTrigger aria-label={t('connect.byokTitle')} className="h-10 min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>{editOnKey && (
              <SelectItem value={KEEP_CURRENT}>
                {c.currentKeyDetail
                  ? t('connect.byokKeepCurrent', { detail: c.currentKeyDetail })
                  : t('connect.byokKeepCurrentPlain')}
              </SelectItem>
            )}
            {/* Nothing picked yet: a key-only type cannot be added on it. */}
            <SelectItem value={NO_ACCESS}>
              {c.keyOnly ? t('connect.byokPickKey') : t('connect.byokPickCredential')}
            </SelectItem>
            {c.signInOffered && (
              <SelectItem value={SIGN_IN}>{t('connect.byokDeviceSignIn', { command: c.deviceLoginCommand })}</SelectItem>
            )}
            {c.deviceKeyOffered && (
              <SelectItem value={DEVICE_KEY}>{t('connect.byokDeviceKey')}</SelectItem>
            )}
            {b.accessOptions.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label} · {a.apiKeyMasked}
              </SelectItem>
            ))}</SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {/* A key-only type with no key. Re-detect brings in a key set
          up on the device meanwhile. */}
      {c.keyMissing && (
        <p
          data-testid="agent-setup-creds-required"
          role={c.credsError ? 'alert' : undefined}
          className={cn('text-xs', c.credsError ? 'font-medium text-destructive' : 'text-muted-foreground')}
        >
          {t('connect.byokKeyRequired', { label })}
          {!c.deviceKeyOffered && selectedStatus !== 'not_installed' && (
            <>{' '}{t('connect.byokKeyAddedOnDevice')}{' '}{reDetectButton}</>
          )}
        </p>
      )}
      {/* A sign-in the device did not confirm. Adding first points
          here, then lets it through as "Add anyway"; editing only
          warns. Re-detect is the way back for someone who just
          signed in. */}
      {c.signInUnconfirmed && (
        <p
          data-testid="agent-setup-not-signed-in"
          role={c.credsError ? 'alert' : undefined}
          className={cn('text-xs', c.credsError ? 'font-medium text-destructive' : 'text-warning')}
        >
          {t(isEdit ? 'connect.byokNotSignedInHint' : 'connect.byokNotSignedInRequired')}{' '}
          {reDetectButton}
        </p>
      )}
      {c.onDeviceKey && (
        <p data-testid="agent-setup-device-key-hint" className="text-xs text-muted-foreground">
          {t('connect.byokDeviceKeyHint', { label, device: node.name || node.hostname || '' })}
        </p>
      )}

      {/* Which credential the agent will run on, in words: the select
          alone did not say that "sign in on the device" means this
          CLI's own account and never a key saved on the device. */}
      {c.signInChosen && (
        <p data-testid="agent-setup-signin-hint" className="text-xs text-muted-foreground">
          {t('connect.byokDeviceSignInHint', { label, command: (selected && runtimeByType[selected]?.loginCommand) || c.loginCommand })}
          {isEdit && editOnKey && <> {t('connect.byokSwitchToSignInHint')}</>}
        </p>
      )}
      {c.keepCurrent && !b.accessId && (
        <Field>
          <FieldLabel>{t('connect.nodeAgentModelOptional')}</FieldLabel>
          <Input
            aria-label={t('connect.nodeModel')}
            value={form.model}
            onChange={(e) => form.setModel(e.target.value)}
            placeholder={t('connect.nodeAgentModelOptional')}
            className="h-10 font-mono text-sm"
          />
          <FieldDescription>{t('connect.byokKeepCurrentModelHint')}</FieldDescription>
        </Field>
      )}

      {/* Optional host-provided one-click access for OpenAI-protocol agents
          (extension point; unused in the open-source build). */}
      {selected && byokProtocol !== 'anthropic' && extensions?.promo?.({
        agentType: selected, accesses: b.accesses, selectedAccessId: b.accessId,
        onUse: (entry, created) => {
          if (created) b.setAccesses((prev) => [entry, ...(prev || [])]);
          b.pickAccess(entry.id);
        },
      })}

      {b.accesses !== null && b.accesses.length === 0 && !b.accessId && (
        <p className="text-xs text-muted-foreground">{t('connect.byokNoAccessHint')}</p>
      )}

      {b.accessId && <ByokModelPicker form={form} />}

      {b.showAccessDialog && extensions?.modelAccessDialog?.({
        onClose: () => b.setShowAccessDialog(false),
        onSaved: (entry) => {
          b.setShowAccessDialog(false);
          b.setAccesses((prev) => [entry, ...(prev || [])]);
          b.pickAccess(entry.id);
        },
      })}
    </div>
  );
}

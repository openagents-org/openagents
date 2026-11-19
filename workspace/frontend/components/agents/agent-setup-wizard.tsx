'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Copy, KeyRound, LogIn, RefreshCw, ShieldCheck, Timer } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { AgentIcon } from '@/components/icons/agent-icons';
import type { AgentCatalogEntry } from '@/lib/types';
import type { AgentSetupProps } from './agent-setup-types';
import type { AgentSetupForm } from './use-agent-setup-form';
import { agentDisplayName } from './agent-display-name';
import { AgentNameField, WorkingDirectoryField } from './agent-setup-name-fields';
import { CodexModeField } from './agent-setup-model-fields';
import { NativeCredentialFields } from './agent-setup-credentials';
import { BrowserAgentLogin } from './browser-agent-login';

/** Name first, then authenticate; optional model discovery never gates progress. */
export function AgentSetupWizard({ form, props, entry, onSubmit }: {
  form: AgentSetupForm; props: AgentSetupProps; entry: AgentCatalogEntry; onSubmit: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState<1 | 2>(1);
  useEffect(() => setStep(1), [entry.name, props.node.nodeId]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customEndpoint, setCustomEndpoint] = useState(!!form.baseUrl);
  const [copied, setCopied] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [browserSignedIn, setBrowserSignedIn] = useState(false);
  useEffect(() => setBrowserSignedIn(false), [entry.name, props.node.nodeId]);
  const agent = agentDisplayName(entry);
  const device = props.node.name || props.node.hostname || '';
  const runtime = form.runtimeByType[entry.name];
  // Detection sends booleans only: never request the machine's existing key.
  const signedIn = browserSignedIn || (!!runtime?.installed && (runtime.signedIn === true || runtime.auth?.mode === 'subscription'));
  const browserLogin = runtime?.browserLogin === true && ['claude', 'codex'].includes(entry.name);
  const canSignIn = !!form.creds.deviceLoginCommand;
  const choice = form.setupAuth ?? (signedIn && canSignIn ? 'subscription' : null);
  const loginCommand = form.creds.deviceLoginCommand;
  const installLater = runtime?.installed === false;
  const options = [
    ...(canSignIn ? [{ id: 'subscription' as const, icon: LogIn, title: t('agentSetup.subscription'), description: t('agentSetup.subscriptionHint') }] : []),
    { id: 'key' as const, icon: KeyRound, title: t('agentSetup.key'), description: t('agentSetup.keyHint') },
    { id: 'later' as const, icon: Timer, title: t('agentSetup.later'), description: t('agentSetup.laterHint') },
  ];
  const choose = (next: 'subscription' | 'key' | 'later') => {
    form.setSetupAuth(next);
    form.setApiKey('');
    form.setNativeValues({});
    form.setBaseUrl('');
    setCustomEndpoint(false);
    form.byokState.setAccessId('');
    form.creds.setKeepCurrent(false);
    form.creds.setSignInPick(next === 'subscription');
    form.creds.setUseDeviceKey(false);
    form.creds.setCredsTouched(true);
    form.setError(null);
    setKeyError(false);
  };
  const nameInvalid = !form.name.trim() || !!form.nameClash || !!form.nameError;
  const continueDisabled = form.busy || nameInvalid || props.extensions?.disabled;
  const continueToAccount = () => {
    if (continueDisabled) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(form.name.trim())) { form.setNameError(t('connect.agentNameInvalid')); return; }
    setStep(2);
  };
  const back = () => {
    if (step === 2) setStep(1);
    else form.backToSelection();
  };
  const submit = () => {
    if (step !== 2 || submitDisabled) return;
    if (!choice) { form.setError(t('agentSetup.chooseAuth')); return; }
    if (choice === 'key' && (form.nativeCreds.length
      ? form.nativeCreds.some((f) => !(form.nativeValues[f.name] || '').trim())
      : !form.apiKey.trim())) { setKeyError(true); return; }
    form.setSetupAuth(choice);
    onSubmit();
  };
  const submitDisabled = (choice === 'key' && form.detailState !== 'ready') || form.busy || props.extensions?.disabled || nameInvalid || !choice ||
    (choice === 'subscription' && !signedIn && (browserLogin || !installLater));
  const deviceModels = runtime?.cliModels || [];

  return (
    <form data-testid="agent-setup-wizard" className="flex h-full min-h-0 w-full flex-col bg-background" onSubmit={(event) => { event.preventDefault(); if (step === 1) continueToAccount(); else submit(); }}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-5 py-7 sm:px-8">
          <button type="button" onClick={form.backToSelection} disabled={form.busy} className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />{t('agentSetup.changeAgent')}
          </button>
          <ol aria-label={t('agentSetup.progress')} className="flex items-center gap-3 text-sm">
            {[{ number: 1, label: t('agentSetup.nameStep') }, { number: 2, label: t('agentSetup.accountStep') }].map(({ number, label }) => (
              <li key={number} aria-current={step === number ? 'step' : undefined} className={cn('flex items-center gap-2', step === number ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {number === 2 && <span aria-hidden="true" className="mr-1 h-px w-8 bg-border" />}
                <span aria-hidden="true" className={cn('flex size-6 items-center justify-center rounded-full text-xs', step >= number ? 'bg-foreground text-background' : 'bg-muted')}>{step > number ? <Check className="size-3.5" /> : number}</span>
                {label}
              </li>
            ))}
          </ol>
          <header className="flex items-center gap-4">
            <AgentIcon name={entry.name} size={48} />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{t(step === 1 ? 'agentSetup.nameTitle' : 'agentSetup.authTitle', { agent })}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('connect.agentRunsOn', { device })}</p>
            </div>
          </header>

          {step === 1 ? (
            <section data-testid="agent-setup-details-step" className="flex flex-col gap-5">
              <p className="text-sm leading-relaxed text-muted-foreground">{t('agentSetup.nameHint')}</p>
              <fieldset disabled={form.busy}><AgentNameField form={form} concise /></fieldset>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('connect.agentNameUniqueHint')}</p>
            </section>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-4 py-3 text-sm">
              <span className="min-w-0 truncate"><span className="text-muted-foreground">{t('connect.nodeAgentNameLabel')}: </span><span className="font-medium">{form.name}</span></span>
              <Button type="button" variant="link" size="xs" onClick={() => setStep(1)} disabled={form.busy}>{t('agentSetup.editName')}</Button>
            </div>
          )}

            <div hidden={step !== 2}><section data-testid="agent-setup-auth-step" className="flex flex-col gap-5">
              <p className="text-sm leading-relaxed text-muted-foreground">{t('agentSetup.authHint')}</p>
              <div role="status" className="flex items-start gap-2.5 text-sm">
                {form.detecting ? <RefreshCw className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" /> : signedIn ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <div className="flex-1 leading-relaxed">
                  {t(form.detecting ? 'agentSetup.checking' : signedIn ? 'agentSetup.signedIn' : form.detectTimedOut ? 'agentSetup.checkingFailed' : runtime?.signedIn === false ? 'agentSetup.notSignedIn' : 'agentSetup.unknown', { device })}
                </div>
                <Button type="button" variant="link" size="xs" className="h-auto shrink-0 px-0" onClick={() => void form.reDetect()} disabled={form.detecting}>{t('agentSetup.checkAgain')}</Button>
              </div>
              <div role="radiogroup" aria-label={t('agentSetup.authentication')} className="flex flex-col gap-2">
                {options.map(({ id, icon: Icon, title, description }) => (
                  <button key={id} type="button" role="radio" aria-checked={choice === id} data-testid={`agent-setup-auth-${id}`} disabled={form.busy} onClick={() => choose(id)} onKeyDown={(event) => {
                    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                    event.preventDefault();
                    const index = options.findIndex((option) => option.id === id);
                    const next = options[(index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : options.length - 1)) % options.length];
                    choose(next.id);
                    event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-testid="agent-setup-auth-${next.id}"]`)?.focus();
                  }} className={cn('flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-50', choice === id && 'border-foreground/70 bg-muted/40')}>
                    <Icon className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span></span>
                    <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', choice === id && 'border-foreground bg-foreground text-background')}>{choice === id && <Check className="size-3" />}</span>
                  </button>
                ))}
              </div>
              {!canSignIn && form.detailState === 'ready' && <p className="text-xs text-muted-foreground">{t('agentSetup.keyOnly')}</p>}
              <fieldset disabled={form.busy || step !== 2} className="flex min-w-0 flex-col gap-4">
                {choice === 'subscription' && (signedIn ? (
                  <p className="text-sm text-muted-foreground">{t('agentSetup.signedInHint')}</p>
                ) : (
                  <div className="flex flex-col gap-3 border-t pt-5">
                    <h2 className="text-sm font-medium">{t('agentSetup.signInTitle', { device })}</h2>
                    {!browserLogin && <p className="text-sm leading-relaxed text-muted-foreground">{t(installLater ? 'agentSetup.installHint' : 'agentSetup.signInHint', { agent, device })}</p>}
                    {browserLogin ? <BrowserAgentLogin key={`${props.node.nodeId}:${entry.name}`} api={props.api} nodeId={props.node.nodeId} type={entry.name} agent={agent} needsInstall={installLater} onSignedIn={() => { setBrowserSignedIn(true); void form.reDetect(); }} /> : form.signIn ? <Button type="button" variant="outline" onClick={form.signIn} className="w-fit">{t('agentSetup.openSignIn', { agent })}<ArrowRight className="size-4" /></Button> : (
                      <div className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3">
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-sm">{loginCommand}</code>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('agentSetup.copy')} onClick={() => void navigator.clipboard.writeText(loginCommand).then(() => setCopied(true)).catch(() => setCopied(false))}>
                          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                        </Button>
                      </div>
                    )}
                    {!browserLogin && <Button type="button" variant="outline" className="w-fit" onClick={() => void form.reDetect()} disabled={form.detecting}><RefreshCw className={cn('size-4', form.detecting && 'animate-spin')} />{t('agentSetup.checkAgain')}</Button>}
                    <p className="text-xs text-muted-foreground">{t('agentSetup.accountModelHint')}</p>
                  </div>
                ))}
                {choice === 'key' && form.detailState !== 'ready' && (
                  form.detailState === 'loading' ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />{t('agentSetup.loading')}</p> :
                  <div role="alert" className="flex items-center justify-between gap-3 text-sm"><span>{t('agentSetup.loadError')}</span><Button type="button" variant="outline" onClick={form.retryDetail}>{t('agentSetup.retry')}</Button></div>
                )}
                {choice === 'key' && form.detailState === 'ready' && (
                  <div className="flex flex-col gap-5 border-t pt-5">
                    {form.nativeCreds.length > 0 ? <NativeCredentialFields form={form} includeModel={false} /> : (
                      <Field>
                        <FieldLabel htmlFor="setup-api-key">{t('agentSetup.keyLabel')}</FieldLabel>
                        <Input id="setup-api-key" type="password" autoComplete="off" spellCheck={false} value={form.apiKey} onChange={(event) => { form.setApiKey(event.target.value); setKeyError(false); }} placeholder={t('agentSetup.keyPlaceholder')} aria-invalid={keyError} />
                      </Field>
                    )}
                    {keyError && <p role="alert" className="text-sm text-destructive">{t('agentSetup.keyRequired')}</p>}
                    <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><p>{t('agentSetup.keySecurity', { device })}</p></div>
                    {!form.detail?.provider_locked && (
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customEndpoint} onChange={(event) => { setCustomEndpoint(event.target.checked); if (!event.target.checked) form.setBaseUrl(''); }} />{t('agentSetup.customEndpoint')}</label>
                    )}
                    {customEndpoint && <Field><FieldLabel htmlFor="setup-endpoint">{t('agentSetup.endpoint')}</FieldLabel><Input id="setup-endpoint" type="url" value={form.baseUrl} onChange={(event) => form.setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></Field>}
                    {customEndpoint && <Field><FieldLabel htmlFor="setup-key-model">{t('agentSetup.model')}</FieldLabel><Input id="setup-key-model" value={form.model} onChange={(event) => form.setModel(event.target.value)} placeholder={t('connect.nodeModelAuto')} /></Field>}
                    {form.creds.customCodex && <CodexModeField form={form} />}
                  </div>
                )}
                {choice === 'later' && <p className="border-t pt-5 text-sm leading-relaxed text-muted-foreground">{t('agentSetup.laterNote', { device })}</p>}
              </fieldset>
            </section></div>
            {step === 1 && <details open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)} className="border-t pt-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-muted-foreground hover:text-foreground">
                <span>{t('agentSetup.optionalSettings')}<span className="mt-1 block text-xs">{form.model || t('connect.nodeModelAuto')}</span></span><ChevronDown className="size-4 shrink-0" />
              </summary>
              <div className="pt-5">
              <fieldset disabled={form.busy} className="flex min-w-0 flex-col gap-5">
                  <Field>
                    <FieldLabel htmlFor="setup-model">{t('connect.nodeAgentModelOptional')}</FieldLabel>
                    <Input id="setup-model" data-testid="agent-setup-model" value={form.model} onChange={(event) => form.setModel(event.target.value)} placeholder={t('connect.nodeModelAuto')} list={deviceModels.length ? 'setup-device-models' : undefined} autoComplete="off" />
                    {deviceModels.length > 0 && <datalist id="setup-device-models">{deviceModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}</datalist>}
                    <FieldDescription>{t('agentSetup.modelHint')}</FieldDescription>
                    {deviceModels.length > 0 && <FieldDescription>{t('agentSetup.deviceModelsHint')}</FieldDescription>}
                  </Field>
                <div><WorkingDirectoryField form={form} api={props.api} node={props.node} extensions={props.extensions} /></div>
              </fieldset>
              </div>
            </details>}
          {form.error && <p role="alert" className="text-sm leading-relaxed text-destructive">{form.error}</p>}
        </div>
      </div>
      <footer className="shrink-0 border-t bg-background">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Button type="button" variant="ghost" onClick={back} disabled={form.busy}><ArrowLeft className="size-4" />{t('agentSetup.back')}</Button>
            {step === 1 ? (
              <Button type="submit" data-testid="agent-setup-continue" disabled={continueDisabled}>{t('agentSetup.continue')}<ArrowRight className="size-4" /></Button>
            ) : <Button type="submit" data-testid="agent-setup-submit" disabled={submitDisabled}>
              {form.busy ? t(choice === 'key' ? 'agentSetup.sending' : 'common.saving') : t(choice === 'later' ? 'agentSetup.finishLater' : choice === 'subscription' && installLater ? 'agentSetup.addThenSignIn' : 'agentSetup.add')}
            </Button>}
        </div>
      </footer>
    </form>
  );
}

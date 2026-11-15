'use client';

/**
 * Add-model-access dialog: a two-pane provider picker. The left pane lists the
 * catalog's providers grouped and with logos; the right pane shows the chosen
 * provider (logo, one-line description, model count, "Get a key" link) and
 * the key form — key, optional label, endpoint URL for custom kinds — with a
 * live check before saving. Used by the Model access settings page and by the
 * agent-config form ("Add new model access…").
 *
 * Provider copy (description / description_zh / key_url) comes from the
 * catalog JSON in /cloud_providers, so adding a provider needs no edit here:
 * anything not placed in a named group lands under "More providers".
 */

import { useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Plus, Zap } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ProviderIcon } from '@/components/icons/agent-icons';
import { ModelAccessProviderList, type ProviderGroup } from './model-access-provider-list';
import { workspaceApi } from '@/lib/api';
import type { CloudAgentProvider, ModelAccessEntry } from '@/lib/types';
import { useI18n, useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Catalog entries that never belong in a key picker. */
const EXCLUDED = new Set(['openagents', 'manus', 'perplexity', 'custom']);

/** Display order. TokenDance (id `tokenpay`) leads by product decision. */
const GROUPS: { key: MessageKey; names: string[] }[] = [
  { key: 'admin.modelAccessGroupPopular', names: ['tokenpay', 'openai', 'anthropic', 'google', 'deepseek', 'openrouter'] },
  { key: 'admin.modelAccessGroupLabs', names: ['xai', 'mistral', 'sensenova'] },
  { key: 'admin.modelAccessGroupFast', names: ['groq', 'cerebras', 'sambanova', 'together', 'fireworks'] },
  { key: 'admin.modelAccessGroupRouters', names: ['orcarouter'] },
];

/** Credential-only kinds outside the catalog; both need an endpoint URL. */
const CUSTOM_KINDS = ['custom', 'custom-anthropic'] as const;
type CustomKind = (typeof CUSTOM_KINDS)[number];
const isCustomKind = (name: string): name is CustomKind => (CUSTOM_KINDS as readonly string[]).includes(name);

/** A provider that can back an agent: has a chat model, or lists models live. */
function canBackAgent(p: CloudAgentProvider): boolean {
  return p.models.length === 0 || p.models.some((m) => m.category === 'chat');
}

export function AddModelAccessDialog({
  providers,
  createdBy,
  onClose,
  onSaved,
}: {
  providers: CloudAgentProvider[];
  createdBy?: string;
  onClose: () => void;
  onSaved: (entry: ModelAccessEntry) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const isZh = locale.toLowerCase().startsWith('zh');

  const options = useMemo(
    () => providers.filter((p) => !EXCLUDED.has(p.name) && canBackAgent(p)),
    [providers],
  );

  // Groups in display order; catalog additions nobody placed yet go to "More".
  const groups = useMemo<ProviderGroup[]>(() => {
    const placed = new Set(GROUPS.flatMap((g) => g.names));
    const out: ProviderGroup[] = GROUPS.map((g) => ({
      key: g.key,
      items: g.names.map((n) => options.find((p) => p.name === n)).filter(Boolean) as CloudAgentProvider[],
    }));
    const extra = options.filter((p) => !placed.has(p.name));
    if (extra.length) out.push({ key: 'admin.modelAccessGroupMore', items: extra });
    return out.filter((g) => g.items.length > 0);
  }, [options]);

  const firstName = groups[0]?.items[0]?.name ?? 'custom';
  const [provider, setProvider] = useState<string>(firstName);
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'warn' | 'fail'; detail?: string }>({ state: 'idle' });

  const custom = isCustomKind(provider);
  const info = custom ? undefined : options.find((p) => p.name === provider);
  const canSubmit = !!provider && !!apiKey.trim() && (!custom || !!baseUrl.trim());

  const providerLabel = (name: string) =>
    name === 'custom' ? t('connect.byokProviderCustom')
    : name === 'custom-anthropic' ? t('connect.byokProviderCustomAnthropic')
    : options.find((p) => p.name === name)?.label || name;

  const description = custom
    ? t(provider === 'custom' ? 'admin.modelAccessCustomDesc' : 'admin.modelAccessCustomAnthropicDesc')
    : (isZh && info?.description_zh) || info?.description || '';

  const modelsMeta = custom
    ? t('admin.modelAccessNeedsEndpoint')
    : info && info.models.length > 0
      ? t('connect.providerModelCount', { count: info.models.length })
      : t('connect.tokenpayModelsHint');

  const choose = (name: string) => {
    if (name === provider) return;
    setProvider(name);
    setCheck({ state: 'idle' });
  };

  const verify = async () => {
    if (!canSubmit) return;
    setCheck({ state: 'checking' });
    try {
      const r = await workspaceApi.modelProbe({
        provider,
        apiKey: apiKey.trim(),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (r.keyOk === false) setCheck({ state: 'fail', detail: r.error || t('connect.byokKeyInvalid') });
      // The endpoint answered but couldn't list models (common for gateways):
      // the key is unconfirmed, not wrong — it can still be tested with a model.
      else if (r.error && r.keyOk !== true) setCheck({ state: 'warn', detail: `${t('admin.modelAccessKeyUnverified')} (${r.error})` });
      else setCheck({ state: 'ok', detail: t('admin.modelAccessKeyOk', { count: (r.models || []).length }) });
    } catch (err) {
      setCheck({ state: 'fail', detail: err instanceof Error ? err.message : String(err) });
    }
  };

  const save = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const entry = await workspaceApi.createModelAccess({
        provider,
        apiKey: apiKey.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(createdBy ? { createdBy } : {}),
      });
      toast.success(t('admin.modelAccessSaved'));
      onSaved(entry);
    } catch {
      toast.error(t('admin.modelAccessSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const resetCheck = () => setCheck({ state: 'idle' });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-3xl md:h-160">
        <DialogHeader>
          <DialogTitle>{t('admin.modelAccessAdd')}</DialogTitle>
          <DialogDescription>{t('admin.modelAccessAddBody')}</DialogDescription>
        </DialogHeader>

        {/* Two panes, each scrolling on its own on desktop: the provider list
            is long and the form beside it should stay in view while picking. */}
        <DialogBody className="grid grid-cols-1 gap-0 border-t px-0 pb-0 md:grid-cols-[14rem_1fr] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
          <div className="no-scrollbar max-h-44 overflow-y-auto border-b p-3 md:max-h-none md:border-e md:border-b-0">
            <ModelAccessProviderList
              groups={groups}
              customKinds={CUSTOM_KINDS}
              selected={provider}
              providerLabel={providerLabel}
              onSelect={choose}
            />
          </div>

          {/* Chosen provider + key form */}
          <div className="no-scrollbar flex min-w-0 flex-col gap-5 overflow-y-auto p-5">
            <div className="flex items-center gap-3">
              <ProviderIcon name={custom ? 'custom' : provider} size={48} />
              <div className="min-w-0">
                <div className="truncate font-heading text-base font-medium">{providerLabel(provider)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {description ? `${description} · ${modelsMeta}` : modelsMeta}
                </div>
              </div>
            </div>

            <FieldGroup className="gap-4">
              {custom && (
                <Field>
                  <FieldLabel htmlFor="model-access-base-url">{t('admin.modelAccessBaseUrl')}</FieldLabel>
                  <Input
                    id="model-access-base-url"
                    value={baseUrl}
                    onChange={(e) => { setBaseUrl(e.target.value); resetCheck(); }}
                    placeholder={t('connect.byokBaseUrlPlaceholder')}
                    className="font-mono"
                  />
                  {provider === 'custom-anthropic' && (
                    <FieldDescription>{t('admin.modelAccessAnthropicCompatHint')}</FieldDescription>
                  )}
                </Field>
              )}

              <Field data-invalid={check.state === 'fail' || undefined}>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="model-access-key">{t('admin.modelAccessKey')}</FieldLabel>
                  {info?.key_url && (
                    <Button variant="link" size="xs" className="h-auto px-0" asChild>
                      <a href={info.key_url} target="_blank" rel="noopener noreferrer">
                        {t('admin.modelAccessGetKey')}
                        <ExternalLink data-icon="inline-end" />
                      </a>
                    </Button>
                  )}
                </div>
                <Input
                  id="model-access-key"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); resetCheck(); }}
                  type="password"
                  autoComplete="off"
                  aria-invalid={check.state === 'fail' || undefined}
                  placeholder={t('connect.byokApiKeyPlaceholder')}
                />
                {provider === 'tokenpay' && <FieldDescription>{t('connect.tokenpayKeyHint')}</FieldDescription>}
              </Field>

              <Field>
                <FieldLabel htmlFor="model-access-label">{t('admin.modelAccessLabel')}</FieldLabel>
                <Input
                  id="model-access-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={providerLabel(provider)}
                />
              </Field>
            </FieldGroup>

            <div className="flex items-start gap-2">
              <Button size="sm" variant="outline" onClick={verify} disabled={!canSubmit || check.state === 'checking'} className="shrink-0">
                {check.state === 'checking' ? <Spinner data-icon="inline-start" /> : <Zap data-icon="inline-start" />}
                {check.state === 'checking' ? t('connect.byokTesting') : t('admin.modelAccessVerify')}
              </Button>
              <p
                role="status"
                className={cn(
                  'flex min-w-0 items-center gap-1 pt-1.5 text-xs',
                  check.state === 'ok' && 'text-success',
                  check.state === 'warn' && 'text-warning',
                  check.state === 'fail' && 'text-destructive',
                )}
              >
                {check.state === 'ok' && <CheckCircle2 className="size-3.5 shrink-0" />}
                {check.state !== 'idle' && check.state !== 'checking' && check.detail}
              </p>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('connect.nodeCancel')}</Button>
          <Button onClick={save} disabled={!canSubmit || saving}>
            {saving ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            {t('admin.modelAccessSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

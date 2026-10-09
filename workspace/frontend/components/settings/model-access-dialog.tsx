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
import { CheckCircle2, ExternalLink, Loader2, Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProviderIcon } from '@/components/icons/agent-icons';
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
  const groups = useMemo(() => {
    const placed = new Set(GROUPS.flatMap((g) => g.names));
    const out = GROUPS.map((g) => ({
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
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'fail'; detail?: string }>({ state: 'idle' });

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
      if (r.keyOk === false || (r.error && r.keyOk !== true)) setCheck({ state: 'fail', detail: r.error || t('connect.byokKeyInvalid') });
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

  const ListItem = ({ name, icon }: { name: string; icon: string }) => (
    <button
      type="button"
      onClick={() => choose(name)}
      aria-pressed={provider === name}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        provider === name
          ? 'bg-foreground text-background'
          : 'hover:bg-muted',
      )}
    >
      <span className="flex size-[18px] shrink-0 items-center justify-center">
        <ProviderIcon name={icon} size={18} />
      </span>
      <span className="truncate">{providerLabel(name)}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[min(40rem,calc(100vh-2rem))] w-full max-w-3xl flex-col rounded-2xl border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-6 pb-4 pt-5">
          <h3 className="text-sm font-semibold">{t('admin.modelAccessAdd')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.modelAccessAddBody')}</p>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[14rem_1fr]">
          {/* Provider list */}
          <nav
            aria-label={t('admin.modelAccessProvider')}
            className="max-h-44 overflow-y-auto border-b px-3 py-3 md:max-h-none md:border-b-0 md:border-r"
          >
            {groups.map((g) => (
              <div key={g.key} className="mb-2">
                <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t(g.key)}
                </div>
                {g.items.map((p) => <ListItem key={p.name} name={p.name} icon={p.name} />)}
              </div>
            ))}
            <div>
              <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('admin.modelAccessGroupCustom')}
              </div>
              {CUSTOM_KINDS.map((k) => <ListItem key={k} name={k} icon="custom" />)}
            </div>
          </nav>

          {/* Chosen provider + key form */}
          <div className="min-w-0 space-y-4 overflow-y-auto px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                <ProviderIcon name={custom ? 'custom' : provider} size={28} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{providerLabel(provider)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {description ? `${description} · ${modelsMeta}` : modelsMeta}
                </div>
              </div>
            </div>

            {custom && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('admin.modelAccessBaseUrl')}</Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); setCheck({ state: 'idle' }); }}
                  placeholder={t('connect.byokBaseUrlPlaceholder')}
                  className="h-10 font-mono text-sm"
                />
                {provider === 'custom-anthropic' && (
                  <p className="text-[11px] text-muted-foreground">{t('admin.modelAccessAnthropicCompatHint')}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium">{t('admin.modelAccessKey')}</Label>
                {info?.key_url && (
                  <a
                    href={info.key_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    {t('admin.modelAccessGetKey')}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <Input
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setCheck({ state: 'idle' }); }}
                type="password"
                autoComplete="off"
                placeholder={t('connect.byokApiKeyPlaceholder')}
                className="h-10 text-sm"
              />
              {provider === 'tokenpay' && (
                <p className="text-[11px] text-muted-foreground">{t('connect.tokenpayKeyHint')}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('admin.modelAccessLabel')}</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={providerLabel(provider)}
                className="h-10 text-sm"
              />
            </div>

            <div className="flex items-start gap-2">
              <Button size="sm" variant="outline" onClick={verify} disabled={!canSubmit || check.state === 'checking'} className="shrink-0">
                {check.state === 'checking'
                  ? (<><Loader2 className="size-3.5 mr-1.5 animate-spin" />{t('connect.byokTesting')}</>)
                  : (<><Zap className="size-3.5 mr-1.5" />{t('admin.modelAccessVerify')}</>)}
              </Button>
              {check.state === 'ok' && (
                <span className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />{check.detail}
                </span>
              )}
              {check.state === 'fail' && (
                <span className="pt-1.5 text-[11px] text-red-600 dark:text-red-400">{check.detail}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('connect.nodeCancel')}</Button>
          <Button
            onClick={save}
            disabled={!canSubmit || saving}
            className={cn(check.state === 'fail' && 'opacity-80')}
          >
            {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Plus className="size-4 mr-1.5" />}
            {t('admin.modelAccessSave')}
          </Button>
        </div>
      </div>
    </div>
  );
}

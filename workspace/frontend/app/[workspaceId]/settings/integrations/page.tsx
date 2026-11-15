'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Copy, Globe, MessageCircle, Send, Slack, Trash2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldLabel } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import type { IntegrationBinding, WorkspaceAgent } from '@/lib/types';
import { useT } from '@/lib/i18n';
import {
  SelectGroup, Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ConnectForm = 'telegram' | 'slack' | 'lark' | null;

/**
 * "No default agent", as a value a Select can hold.
 *
 * Radix refuses an empty string for an item — it reserves it for "nothing is
 * selected" — so the absence has to travel under a name of its own and be
 * turned back into '' at the edge, which is what the API stores.
 */
const NO_AGENT = '__none__';

export default function IntegrationsSettingsPage() {
  const { workspace, me, refreshWorkspace } = useAdminSettings();
  const t = useT();
  const confirm = useConfirm();
  const editable = canAdminister(me);

  const [bfApiKey, setBfApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const [bindings, setBindings] = useState<IntegrationBinding[]>([]);
  const [slackAppConfigured, setSlackAppConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [openForm, setOpenForm] = useState<ConnectForm>(null);
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [larkAppId, setLarkAppId] = useState('');
  const [larkVerificationToken, setLarkVerificationToken] = useState('');
  const [larkEncryptKey, setLarkEncryptKey] = useState('');
  const [defaultAgent, setDefaultAgent] = useState('');
  const [connecting, setConnecting] = useState(false);

  const loadBindings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await workspaceApi.listIntegrations();
      setBindings(data.integrations);
      setSlackAppConfigured(data.slackAppConfigured);
    } catch {
      setBindings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBindings();
    workspaceApi.listAgents().then(setAgents).catch(() => setAgents([]));
  }, [loadBindings]);

  // Returning from the Slack OAuth screen: the callback redirects back here
  // with ?slack=connected or ?slack_error=…. Toast it and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('slack');
    const oauthError = params.get('slack_error');
    if (!connected && !oauthError) return;
    if (connected === 'connected') {
      toast.success(t('admin.integrationConnected', { name: 'Slack' }));
    } else if (oauthError) {
      toast.error(t('admin.integrationConnectFailed', { error: oauthError }));
    }
    params.delete('slack');
    params.delete('slack_error');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const startSlackInstall = async () => {
    setConnecting(true);
    try {
      window.location.href = await workspaceApi.getSlackInstallUrl();
      // navigation takes over; no need to reset `connecting`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('admin.integrationConnectFailed', { error: message.slice(0, 200) }));
      setConnecting(false);
    }
  };

  const handleSave = async () => {
    if (!bfApiKey.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.updateWorkspace({ browserfabric_api_key: bfApiKey.trim() });
      await refreshWorkspace();
      setBfApiKey('');
      toast.success(t('settings.saved'));
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openConnect = (platform: ConnectForm) => {
    setOpenForm(platform === openForm ? null : platform);
    setBotToken('');
    setSigningSecret('');
    setLarkAppId('');
    setLarkVerificationToken('');
    setLarkEncryptKey('');
    setDefaultAgent('');
  };

  const formIncomplete =
    !botToken.trim() ||
    (openForm === 'slack' && !signingSecret.trim()) ||
    (openForm === 'lark' && (!larkAppId.trim() || !larkVerificationToken.trim()));

  const connect = async () => {
    if (!openForm || formIncomplete) return;
    setConnecting(true);
    try {
      const binding = await workspaceApi.createIntegration({
        platform: openForm,
        botToken: botToken.trim(),
        signingSecret: openForm === 'slack' ? signingSecret.trim() : undefined,
        appId: openForm === 'lark' ? larkAppId.trim() : undefined,
        verificationToken: openForm === 'lark' ? larkVerificationToken.trim() : undefined,
        encryptKey: openForm === 'lark' ? larkEncryptKey.trim() || undefined : undefined,
        defaultAgent: defaultAgent || undefined,
      });
      toast.success(t('admin.integrationConnected', { name: binding.name || binding.platform }));
      setOpenForm(null);
      await loadBindings();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('admin.integrationConnectFailed', { error: message.slice(0, 200) }));
    } finally {
      setConnecting(false);
    }
  };

  const changeDefaultAgent = async (binding: IntegrationBinding, agent: string) => {
    try {
      await workspaceApi.updateIntegration(binding.id, { defaultAgent: agent });
      toast.success(t('admin.integrationUpdated'));
      await loadBindings();
    } catch {
      toast.error(t('admin.integrationUpdateFailed'));
    }
  };

  const remove = async (binding: IntegrationBinding) => {
    const ok = await confirm({
      title: t('admin.integrationRemoveTitle'),
      description: t('admin.integrationRemoveDescription', {
        name: binding.name || binding.platform,
      }),
      confirmText: t('admin.integrationRemove'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await workspaceApi.deleteIntegration(binding.id);
      toast.success(t('admin.integrationRemoved'));
      await loadBindings();
    } catch {
      toast.error(t('admin.integrationRemoveFailed'));
    }
  };

  const copyEventsUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success(t('admin.copied'));
  };

  const agentPicker = (value: string, onChange: (v: string) => void) => (
    <Select
      value={value || NO_AGENT}
      onValueChange={(v) => onChange(v === NO_AGENT ? '' : v)}
      disabled={!editable}
    >
      <SelectTrigger className="h-9 w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup><SelectItem value={NO_AGENT}>{t('admin.integrationNoDefaultAgent')}</SelectItem>
        {agents.map((a) => (
          <SelectItem key={a.agentName} value={a.agentName}>
            {a.agentName}
          </SelectItem>
        ))}</SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title={t('admin.integrationsTitle')}
        description={t('admin.integrationsDescription')}
      />
      {!editable && <ReadOnlyBanner />}

      {/* ── Chat platforms (Slack / Telegram bridges) ── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <MessageCircle className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('admin.chatPlatformsTitle')}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('admin.chatPlatformsHint')}</p>
        </div>

        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => openConnect('telegram')}>
              <Send className="size-3.5" />
              {t('admin.connectTelegram')}
            </Button>
            {slackAppConfigured ? (
              <>
                <Button size="sm" onClick={startSlackInstall} disabled={connecting}>
                  {connecting ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <Slack className="size-3.5" />
                  )}
                  {t('admin.addToSlack')}
                </Button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => openConnect('slack')}
                >
                  {t('admin.useCustomSlackApp')}
                </button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => openConnect('slack')}>
                <Slack className="size-3.5" />
                {t('admin.connectSlack')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => openConnect('lark')}>
              <Bot className="size-3.5" />
              {t('admin.connectLark')}
            </Button>
          </div>
        )}

        {openForm && (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">
              {openForm === 'telegram'
                ? t('admin.telegramHelp')
                : openForm === 'slack'
                  ? t('admin.slackHelp')
                  : t('admin.larkHelp')}
            </p>
            {openForm === 'lark' && (
              <Field>
                <FieldLabel>{t('admin.larkAppIdLabel')}</FieldLabel>
                <Input
                  value={larkAppId}
                  onChange={(e) => setLarkAppId(e.target.value)}
                  placeholder="cli_…"
                  className="font-mono text-xs"
                />
              </Field>
            )}
            <Field>
              <FieldLabel>
                {openForm === 'telegram'
                  ? t('admin.telegramTokenLabel')
                  : openForm === 'slack'
                    ? t('admin.slackTokenLabel')
                    : t('admin.larkAppSecretLabel')}
              </FieldLabel>
              <Input
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={
                  openForm === 'telegram'
                    ? t('admin.telegramTokenPlaceholder')
                    : openForm === 'slack'
                      ? t('admin.slackTokenPlaceholder')
                      : ''
                }
                className="font-mono text-xs"
              />
            </Field>
            {openForm === 'slack' && (
              <Field>
                <FieldLabel>{t('admin.slackSigningSecretLabel')}</FieldLabel>
                <Input
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder={t('admin.slackSigningSecretPlaceholder')}
                  className="font-mono text-xs"
                />
              </Field>
            )}
            {openForm === 'lark' && (
              <>
                <Field>
                  <FieldLabel>{t('admin.larkVerificationTokenLabel')}</FieldLabel>
                  <Input
                    value={larkVerificationToken}
                    onChange={(e) => setLarkVerificationToken(e.target.value)}
                    placeholder={t('admin.larkCredentialsHint')}
                    className="font-mono text-xs"
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('admin.larkEncryptKeyLabel')}</FieldLabel>
                  <Input
                    value={larkEncryptKey}
                    onChange={(e) => setLarkEncryptKey(e.target.value)}
                    placeholder={t('admin.larkEncryptKeyPlaceholder')}
                    className="font-mono text-xs"
                  />
                </Field>
              </>
            )}
            <Field>
              <FieldLabel>{t('admin.integrationDefaultAgent')}</FieldLabel>
              <div>{agentPicker(defaultAgent, setDefaultAgent)}</div>
            </Field>
            <div className="flex justify-end">
              <Button size="sm" onClick={connect} disabled={connecting || formIncomplete}>
                {connecting ? (
                  <Spinner />
                ) : openForm === 'telegram' ? (
                  t('admin.connectTelegram')
                ) : openForm === 'slack' ? (
                  t('admin.connectSlack')
                ) : (
                  t('admin.connectLark')
                )}
              </Button>
            </div>
          </div>
        )}

        {loading && bindings.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : bindings.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('admin.noIntegrations')}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {bindings.map((b) => (
              <div key={b.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  {b.platform === 'slack' ? (
                    <Slack className="size-5 shrink-0 text-muted-foreground" />
                  ) : b.platform === 'lark' ? (
                    <Bot className="size-5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Send className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {b.name || b.platform}
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          b.status === 'active' && !b.lastError ? 'bg-success' : 'bg-warning'
                        }`}
                        title={b.status === 'active' ? b.lastError || b.status : t('admin.integrationDisabled')}
                      />
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        b.botTokenMasked,
                        b.lastEventAt &&
                          t('admin.lastSeen', { time: new Date(b.lastEventAt).toLocaleString() }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {agentPicker(b.defaultAgent || '', (v) => changeDefaultAgent(b, v))}
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(b)}
                      title={t('admin.integrationRemove')}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
                {b.platform === 'slack' && b.slackEventsUrl && (
                  <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-2">
                    <p className="text-xs font-medium">{t('admin.slackEventsUrlLabel')}</p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {b.slackEventsUrl}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => copyEventsUrl(b.slackEventsUrl!)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('admin.slackEventsUrlHint')}</p>
                  </div>
                )}
                {b.platform === 'lark' && b.larkEventsUrl && (
                  <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-2">
                    <p className="text-xs font-medium">{t('admin.larkEventsUrlLabel')}</p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {b.larkEventsUrl}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => copyEventsUrl(b.larkEventsUrl!)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('admin.larkEventsUrlHint')}</p>
                  </div>
                )}
                {b.lastError && (
                  <p className="truncate text-xs text-warning">
                    {t('admin.integrationLastError', { error: b.lastError })}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── BrowserFabric API key ── */}
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <Label>{t('settings.browserFabricKey')}</Label>
        </div>
        {workspace.browserfabricApiKey && (
          <p className="font-mono text-xs text-muted-foreground">
            {t('settings.browserFabricCurrent', { key: workspace.browserfabricApiKey })}
          </p>
        )}
        <Input
          value={bfApiKey}
          onChange={(e) => setBfApiKey(e.target.value)}
          placeholder={
            workspace.browserfabricApiKey
              ? t('settings.browserFabricReplace')
              : t('settings.browserFabricPlaceholder')
          }
          className="font-mono text-xs"
          disabled={!editable}
        />
        <p className="text-xs text-muted-foreground">{t('settings.browserFabricHint')}</p>
        {editable && (
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving || !bfApiKey.trim()}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Globe, Loader2, MessageCircle, Send, Slack, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import type { IntegrationBinding, WorkspaceAgent } from '@/lib/types';
import { useT } from '@/lib/i18n';

type ConnectForm = 'telegram' | 'slack' | null;

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
    setDefaultAgent('');
  };

  const connect = async () => {
    if (!openForm || !botToken.trim()) return;
    if (openForm === 'slack' && !signingSecret.trim()) return;
    setConnecting(true);
    try {
      const binding = await workspaceApi.createIntegration({
        platform: openForm,
        botToken: botToken.trim(),
        signingSecret: openForm === 'slack' ? signingSecret.trim() : undefined,
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
    <select
      className="h-9 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={!editable}
    >
      <option value="">{t('admin.integrationNoDefaultAgent')}</option>
      {agents.map((a) => (
        <option key={a.agentName} value={a.agentName}>{a.agentName}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-8">
      <SectionHeader
        title={t('admin.integrationsTitle')}
        description={t('admin.integrationsDescription')}
      />
      {!editable && <ReadOnlyBanner />}

      {/* ── Chat platforms (Slack / Telegram bridges) ── */}
      <div className="space-y-3">
        <div className="space-y-1">
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
                    <Loader2 className="size-3.5 animate-spin" />
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
          </div>
        )}

        {openForm && (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">
              {openForm === 'telegram' ? t('admin.telegramHelp') : t('admin.slackHelp')}
            </p>
            <div className="space-y-2">
              <Label>
                {openForm === 'telegram' ? t('admin.telegramTokenLabel') : t('admin.slackTokenLabel')}
              </Label>
              <Input
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={
                  openForm === 'telegram'
                    ? t('admin.telegramTokenPlaceholder')
                    : t('admin.slackTokenPlaceholder')
                }
                className="font-mono text-xs"
              />
            </div>
            {openForm === 'slack' && (
              <div className="space-y-2">
                <Label>{t('admin.slackSigningSecretLabel')}</Label>
                <Input
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder={t('admin.slackSigningSecretPlaceholder')}
                  className="font-mono text-xs"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('admin.integrationDefaultAgent')}</Label>
              <div>{agentPicker(defaultAgent, setDefaultAgent)}</div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={connect}
                disabled={
                  connecting || !botToken.trim() || (openForm === 'slack' && !signingSecret.trim())
                }
              >
                {connecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : openForm === 'telegram' ? (
                  t('admin.connectTelegram')
                ) : (
                  t('admin.connectSlack')
                )}
              </Button>
            </div>
          </div>
        )}

        {loading && bindings.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : bindings.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('admin.noIntegrations')}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {bindings.map((b) => (
              <div key={b.id} className="space-y-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  {b.platform === 'slack' ? (
                    <Slack className="size-5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Send className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {b.name || b.platform}
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          b.status === 'active' && !b.lastError ? 'bg-emerald-500' : 'bg-amber-500'
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
                  <div className="space-y-1 rounded-md bg-muted/40 p-2">
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
                {b.lastError && (
                  <p className="truncate text-xs text-amber-600 dark:text-amber-500">
                    {t('admin.integrationLastError', { error: b.lastError })}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── BrowserFabric API key ── */}
      <div className="space-y-2 rounded-lg border p-4">
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

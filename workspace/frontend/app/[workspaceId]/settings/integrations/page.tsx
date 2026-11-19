'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, MessageCircle, Send, Slack } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldSeparator } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListEmpty, ListLoading, SettingsList } from '@/components/settings/settings-list';
import { BrowserFabricKeyCard } from '@/components/settings/integrations/browser-fabric-key-card';
import { IntegrationBindingItem } from '@/components/settings/integrations/integration-binding-item';
import {
  IntegrationConnectForm,
  type ChatPlatform,
} from '@/components/settings/integrations/integration-connect-form';
import { workspaceApi } from '@/lib/api';
import type { IntegrationBinding, WorkspaceAgent } from '@/lib/types';
import { useT } from '@/lib/i18n';

export default function IntegrationsSettingsPage() {
  const { me } = useAdminSettings();
  const t = useT();
  const confirm = useConfirm();
  const editable = canAdminister(me);

  const [bindings, setBindings] = useState<IntegrationBinding[]>([]);
  const [slackAppConfigured, setSlackAppConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [openForm, setOpenForm] = useState<ChatPlatform | null>(null);
  const [installingSlack, setInstallingSlack] = useState(false);

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
    setInstallingSlack(true);
    try {
      window.location.href = await workspaceApi.getSlackInstallUrl();
      // navigation takes over; no need to reset the flag
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('admin.integrationConnectFailed', { error: message.slice(0, 200) }));
      setInstallingSlack(false);
    }
  };

  const toggleForm = (platform: ChatPlatform) => setOpenForm((open) => (open === platform ? null : platform));

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

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t('admin.integrationsTitle')}
        description={t('admin.integrationsDescription')}
      />
      {!editable && <ReadOnlyBanner />}

      {/* ── Chat platforms (Slack / Telegram / Lark bridges) ── */}
      <SettingsCard title={t('admin.chatPlatformsTitle')} description={t('admin.chatPlatformsHint')}>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => toggleForm('telegram')}>
              <Send data-icon="inline-start" />
              {t('admin.connectTelegram')}
            </Button>
            {slackAppConfigured ? (
              <>
                <Button size="sm" onClick={startSlackInstall} disabled={installingSlack}>
                  {installingSlack ? <Spinner data-icon="inline-start" /> : <Slack data-icon="inline-start" />}
                  {t('admin.addToSlack')}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto px-0 text-muted-foreground"
                  onClick={() => toggleForm('slack')}
                >
                  {t('admin.useCustomSlackApp')}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => toggleForm('slack')}>
                <Slack data-icon="inline-start" />
                {t('admin.connectSlack')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => toggleForm('lark')}>
              <Bot data-icon="inline-start" />
              {t('admin.connectLark')}
            </Button>
          </div>
        )}

        {openForm && (
          <>
            <FieldSeparator />
            <IntegrationConnectForm
              key={openForm}
              platform={openForm}
              agents={agents}
              onConnected={() => {
                setOpenForm(null);
                loadBindings();
              }}
            />
            <FieldSeparator />
          </>
        )}

        {loading && bindings.length === 0 ? (
          <ListLoading />
        ) : bindings.length === 0 ? (
          <ListEmpty icon={<MessageCircle />}>{t('admin.noIntegrations')}</ListEmpty>
        ) : (
          <SettingsList>
            {bindings.map((b) => (
              <IntegrationBindingItem
                key={b.id}
                binding={b}
                agents={agents}
                editable={editable}
                onChangeAgent={(agent) => changeDefaultAgent(b, agent)}
                onRemove={() => remove(b)}
              />
            ))}
          </SettingsList>
        )}
      </SettingsCard>

      <BrowserFabricKeyCard editable={editable} />
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Download, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { FieldSeparator } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ApiKeyBox, CopyBlock } from '@/components/settings/hub-apps/api-key-box';
import { ConnectedAppList } from '@/components/settings/hub-apps/connected-app-list';
import { SectionHeader } from '@/components/settings/section-chrome';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListLoading } from '@/components/settings/settings-list';
import {
  createHubApiKey, listHubCredentials, revokeHubCredential, type HubCredentials,
} from '@/lib/account-api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';

/** The apps people connect from, in the order the picker shows them. */
const HUB_APPS = [
  { id: 'chatgpt', label: 'ChatGPT', icon: '/icons/agents/openai.svg' },
  { id: 'claude', label: 'Claude', icon: '/icons/agents/claude.svg' },
  { id: 'muse', label: 'Muse', icon: '/icons/apps/meta.svg' },
  { id: 'coding', label: 'Claude Code · Codex', icon: '/icons/agents/codex.svg' },
  { id: 'slack', label: 'Slack', icon: '/icons/apps/slack.svg' },
  { id: 'lark', label: 'Lark', icon: '/icons/apps/lark.svg' },
] as const;
type HubAppId = (typeof HUB_APPS)[number]['id'];

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal flex flex-col gap-3 ps-5 text-sm marker:text-muted-foreground">{children}</ol>;
}

/**
 * Personal settings for the agent hub. Pick the app you use and follow its
 * steps: chat apps add the MCP connector, assistants and coding agents use
 * the API key, Slack and Lark connect through workspace integrations.
 */
export default function ConnectedAppsPage() {
  const t = useT();
  const confirm = useConfirm();
  const params = useParams<{ workspaceId: string }>();
  const { user, idToken, loading: authLoading, signIn } = useOpenAgentsAuth();
  const [data, setData] = useState<HubCredentials | null>(null);
  const [app, setApp] = useState<HubAppId>('chatgpt');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!idToken) return;
    try { setData(await listHubCredentials(idToken)); } catch { toast.error(t('hubApps.loadFailed')); }
  }, [idToken, t]);
  useEffect(() => { void load(); }, [load]);

  if (!authLoading && !user) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader title={t('hubApps.title')} description={t('hubApps.description')} />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><LogIn /></EmptyMedia>
            <EmptyDescription>{t('hubApps.signInPrompt')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => goToCentralLogin(signIn)}>
              <LogIn data-icon="inline-start" />
              {t('userMenu.signIn')}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  if (!data) return <ListLoading />;

  const apiKey = data.api_keys[0] ?? null;
  const keyValue = fresh ?? 'oa_pk_…';

  const createKey = async (replace: boolean) => {
    if (!idToken) return;
    if (replace && !(await confirm({ title: t('hubApps.regenerateConfirm'), destructive: true }))) return;
    setBusy(true);
    try {
      const created = await createHubApiKey(idToken, { replace });
      setFresh(created.key);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string, message: string) => {
    if (!idToken || !(await confirm({ title: message, destructive: true }))) return;
    try {
      await revokeHubCredential(idToken, id);
      if (apiKey?.id === id) setFresh(null);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const keyBox = <ApiKeyBox apiKey={apiKey} fresh={fresh} busy={busy} onCreate={createKey} />;
  const integrations = `/${encodeURIComponent(params.workspaceId)}/settings/integrations`;
  const instructions: Record<HubAppId, React.ReactNode> = {
    chatgpt: (
      <Steps>
        <li>{t('hubApps.chatgptStep1')}</li>
        <li className="flex flex-col gap-2"><span>{t('hubApps.pasteUrl')}</span><CopyBlock value={data.mcp_url} /></li>
        <li>{t('hubApps.signInAllow')}</li>
      </Steps>
    ),
    claude: (
      <Steps>
        <li>{t('hubApps.claudeStep1')}</li>
        <li className="flex flex-col gap-2"><span>{t('hubApps.pasteUrl')}</span><CopyBlock value={data.mcp_url} /></li>
        <li>{t('hubApps.signInAllow')}</li>
      </Steps>
    ),
    muse: (
      <Steps>
        <li className="flex flex-col gap-2"><span>{t('hubApps.keyStep')}</span>{keyBox}</li>
        <li className="flex flex-col gap-2">
          <span>{t('hubApps.museStep2')}</span>
          <CopyBlock value={t('hubApps.instructions', { docs: data.docs_url, key: keyValue })} />
        </li>
        <li>{t('hubApps.museStep3')}</li>
      </Steps>
    ),
    coding: (
      <Steps>
        <li className="flex flex-col gap-2">
          <span>{t('hubApps.skillHint')}</span>
          <div>
            <Button variant="outline" size="sm" asChild>
              <a href={data.skill_url} download><Download data-icon="inline-start" />{t('hubApps.skillDownload')}</a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('hubApps.skillInstallLabel')}</p>
          <CopyBlock value={`mkdir -p ~/.claude/skills && curl -fsSL ${data.skill_url} -o /tmp/openagents-skill.zip && unzip -o /tmp/openagents-skill.zip -d ~/.claude/skills`} />
        </li>
        <li className="flex flex-col gap-2"><span>{t('hubApps.keyStep')}</span>{keyBox}</li>
        <li className="flex flex-col gap-2"><span>{t('hubApps.envLabel')}</span><CopyBlock value={`export OPENAGENTS_API_KEY=${keyValue}`} /></li>
      </Steps>
    ),
    slack: (
      <Steps>
        <li>{t('hubApps.slackStep1')}</li>
        <li>{t('hubApps.slackStep2')}</li>
        <li><Button variant="outline" size="sm" asChild><Link href={integrations}>{t('hubApps.openIntegrations')}</Link></Button></li>
      </Steps>
    ),
    lark: (
      <Steps>
        <li>{t('hubApps.larkStep1')}</li>
        <li>{t('hubApps.larkStep2')}</li>
        <li><Button variant="outline" size="sm" asChild><Link href={integrations}>{t('hubApps.openIntegrations')}</Link></Button></li>
      </Steps>
    ),
  };
  const selected = HUB_APPS.find((a) => a.id === app)!;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t('hubApps.title')} description={t('hubApps.description')} />

      <SettingsCard title={t('hubApps.pickTitle')}>
        <ToggleGroup
          type="single"
          variant="outline"
          value={app}
          // A single toggle group clears its value when the chosen item is
          // clicked again; one app always stays picked.
          onValueChange={(value) => { if (value) setApp(value as HubAppId); }}
          aria-label={t('hubApps.pickTitle')}
          className="grid w-full grid-cols-3 sm:grid-cols-6"
        >
          {HUB_APPS.map((option) => (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              className="h-auto flex-col gap-2 px-2 py-3 text-xs whitespace-normal"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={option.icon} alt="" className="size-8 rounded-md" />
              <span className="text-center leading-tight">{option.label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldSeparator />
        <div role="region" aria-labelledby="hub-app-connect-title" className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.icon} alt="" className="size-5" />
            <h3 id="hub-app-connect-title" className="text-sm font-medium">{t('hubApps.connectTitle', { app: selected.label })}</h3>
          </div>
          {instructions[app]}
        </div>
      </SettingsCard>

      <ConnectedAppList data={data} apiKey={apiKey} onRevoke={revoke} />
    </div>
  );
}

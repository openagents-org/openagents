'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Check, Copy, Download, ExternalLink, KeyRound, Loader2, LogIn, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/settings/section-chrome';
import { useConfirm } from '@/components/ui/dialogs-provider';
import {
  createHubApiKey, listHubCredentials, revokeHubCredential, type HubApiKey, type HubCredentials,
} from '@/lib/account-api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

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

function CopyField({ value, label }: { value: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: the text stays selectable */ }
  };
  return (
    <div className="flex items-start gap-2">
      <code aria-label={label} className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted/40 px-3 py-2 text-xs">{value}</code>
      <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? t('hubApps.copied') : t('hubApps.copy')}
      </Button>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-3 ps-5 text-sm marker:text-muted-foreground">{children}</ol>;
}

/**
 * The person's one API key: create it, or regenerate it (which retires the
 * old one). The secret is shown once, right after it is made.
 */
function ApiKeyBox({ apiKey, fresh, busy, onCreate }: {
  apiKey: HubApiKey | null; fresh: string | null; busy: boolean; onCreate: (replace: boolean) => void;
}) {
  const t = useT();
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
  if (fresh) {
    return (
      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
        <p className="text-sm font-medium">{t('hubApps.newKeyTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('hubApps.newKeyHint')}</p>
        <CopyField value={fresh} label={t('hubApps.keysTitle')} />
      </div>
    );
  }
  if (!apiKey) {
    return (
      <Button onClick={() => onCreate(false)} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{t('hubApps.createKey')}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5">
      <KeyRound className="size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <code className="text-xs">{apiKey.prefix}…</code>
        <div className="text-xs text-muted-foreground">
          {t('hubApps.createdOn', { date: date(apiKey.created_at) })} · {apiKey.last_used_at ? t('hubApps.lastUsed', { date: date(apiKey.last_used_at) }) : t('hubApps.neverUsed')}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => onCreate(true)} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}{t('hubApps.regenerateKey')}
      </Button>
    </div>
  );
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
      <div className="space-y-8">
        <SectionHeader title={t('hubApps.title')} description={t('hubApps.description')} />
        <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">{t('hubApps.signInPrompt')}</p>
          <Button size="sm" onClick={() => goToCentralLogin(signIn)}><LogIn className="size-4" />{t('userMenu.signIn')}</Button>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }

  const apiKey = data.api_keys[0] ?? null;
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
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
        <li className="space-y-2"><span>{t('hubApps.pasteUrl')}</span><CopyField value={data.mcp_url} /></li>
        <li>{t('hubApps.signInAllow')}</li>
      </Steps>
    ),
    claude: (
      <Steps>
        <li>{t('hubApps.claudeStep1')}</li>
        <li className="space-y-2"><span>{t('hubApps.pasteUrl')}</span><CopyField value={data.mcp_url} /></li>
        <li>{t('hubApps.signInAllow')}</li>
      </Steps>
    ),
    muse: (
      <Steps>
        <li className="space-y-2"><span>{t('hubApps.keyStep')}</span>{keyBox}</li>
        <li className="space-y-2">
          <span>{t('hubApps.museStep2')}</span>
          <CopyField value={t('hubApps.instructions', { docs: data.docs_url, key: keyValue })} />
        </li>
        <li>{t('hubApps.museStep3')}</li>
      </Steps>
    ),
    coding: (
      <Steps>
        <li className="space-y-2">
          <span>{t('hubApps.skillHint')}</span>
          <div>
            <Button variant="outline" size="sm" asChild>
              <a href={data.skill_url} download><Download className="size-4" />{t('hubApps.skillDownload')}</a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('hubApps.skillInstallLabel')}</p>
          <CopyField value={`mkdir -p ~/.claude/skills && curl -fsSL ${data.skill_url} -o /tmp/openagents-skill.zip && unzip -o /tmp/openagents-skill.zip -d ~/.claude/skills`} />
        </li>
        <li className="space-y-2"><span>{t('hubApps.keyStep')}</span>{keyBox}</li>
        <li className="space-y-2"><span>{t('hubApps.envLabel')}</span><CopyField value={`export OPENAGENTS_API_KEY=${keyValue}`} /></li>
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
    <div className="space-y-8">
      <SectionHeader title={t('hubApps.title')} description={t('hubApps.description')} />

      <section className="space-y-4">
        <h3 className="text-sm font-medium">{t('hubApps.pickTitle')}</h3>
        <div role="tablist" aria-label={t('hubApps.pickTitle')} className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {HUB_APPS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={app === option.id}
              onClick={() => setApp(option.id)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border px-2 py-3 text-xs font-medium transition-colors hover:bg-muted/50',
                app === option.id && 'border-primary bg-primary/5 ring-1 ring-primary',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={option.icon} alt="" className="size-8 rounded-md" />
              <span className="text-center leading-tight">{option.label}</span>
            </button>
          ))}
        </div>
        <div role="tabpanel" className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.icon} alt="" className="size-5" />
            <h4 className="text-sm font-medium">{t('hubApps.connectTitle', { app: selected.label })}</h4>
          </div>
          {instructions[app]}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('hubApps.appsTitle')}</h3>
        <ul className="divide-y rounded-md border">
          {data.connected_apps.length === 0 && !apiKey && <li className="px-3 py-2.5 text-sm text-muted-foreground">{t('hubApps.appsEmpty')}</li>}
          {data.connected_apps.map((connected) => (
            <li key={connected.client_id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{connected.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t('hubApps.connectedOn', { date: date(connected.connected_at) })} · {connected.last_used_at ? t('hubApps.lastUsed', { date: date(connected.last_used_at) }) : t('hubApps.neverUsed')}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => revoke(connected.id, t('hubApps.disconnectConfirm', { name: connected.name }))}>{t('hubApps.disconnect')}</Button>
            </li>
          ))}
          {apiKey && (
            <li className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t('hubApps.keysTitle')} <code className="ms-1 text-xs text-muted-foreground">{apiKey.prefix}…</code></div>
                <div className="text-xs text-muted-foreground">
                  {t('hubApps.createdOn', { date: date(apiKey.created_at) })} · {apiKey.last_used_at ? t('hubApps.lastUsed', { date: date(apiKey.last_used_at) }) : t('hubApps.neverUsed')}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => revoke(apiKey.id, t('hubApps.revokeConfirm', { name: t('hubApps.keysTitle') }))}>{t('hubApps.revoke')}</Button>
            </li>
          )}
        </ul>
        <a href={data.docs_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          {t('hubApps.docsLink')}<ExternalLink className="size-3" />
        </a>
      </section>
    </div>
  );
}

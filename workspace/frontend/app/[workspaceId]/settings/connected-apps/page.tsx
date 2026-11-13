'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, KeyRound, Loader2, LogIn, Plug, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionHeader } from '@/components/settings/section-chrome';
import { useConfirm } from '@/components/ui/dialogs-provider';
import {
  createHubApiKey, listHubCredentials, revokeHubCredential, type HubCredentials,
} from '@/lib/account-api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';

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

/**
 * Personal settings for the agent hub: the MCP URL to add in ChatGPT/Claude,
 * the apps that are connected through OAuth, and personal API keys for
 * assistants that can only follow written instructions.
 */
export default function ConnectedAppsPage() {
  const t = useT();
  const confirm = useConfirm();
  const { user, idToken, loading: authLoading, signIn } = useOpenAgentsAuth();
  const [data, setData] = useState<HubCredentials | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!idToken) return;
    try { setData(await listHubCredentials(idToken)); } catch { toast.error(t('hubApps.loadFailed')); }
  }, [idToken, t]);
  useEffect(() => { void load(); }, [load]);

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

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

  const create = async () => {
    if (!idToken || !name.trim()) return;
    setCreating(true);
    try {
      const created = await createHubApiKey(idToken, name.trim());
      setNewKey(created.key);
      setName('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };
  const revoke = async (id: string, message: string) => {
    if (!idToken || !(await confirm({ title: message, destructive: true }))) return;
    try { await revokeHubCredential(idToken, id); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="space-y-8">
      <SectionHeader title={t('hubApps.title')} description={t('hubApps.description')} />

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Plug className="size-4" />{t('hubApps.mcpTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('hubApps.mcpHint')}</p>
        <CopyField value={data.mcp_url} label={t('hubApps.mcpTitle')} />
        <ul className="divide-y rounded-md border">
          {data.connected_apps.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">{t('hubApps.appsEmpty')}</li>}
          {data.connected_apps.map((app) => (
            <li key={app.client_id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{app.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t('hubApps.connectedOn', { date: date(app.connected_at) })} · {app.last_used_at ? t('hubApps.lastUsed', { date: date(app.last_used_at) }) : t('hubApps.neverUsed')}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => revoke(app.id, t('hubApps.disconnectConfirm', { name: app.name }))}>{t('hubApps.disconnect')}</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4" />{t('hubApps.skillTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('hubApps.skillHint')}</p>
        <Button variant="outline" size="sm" asChild>
          <a href={data.skill_url} download><Download className="size-4" />{t('hubApps.skillDownload')}</a>
        </Button>
        <p className="text-xs font-medium">{t('hubApps.skillInstallLabel')}</p>
        <CopyField value={`mkdir -p ~/.claude/skills && curl -fsSL ${data.skill_url} -o /tmp/openagents-skill.zip && unzip -o /tmp/openagents-skill.zip -d ~/.claude/skills`} />
        <p className="text-xs font-medium">{t('hubApps.skillKeyLabel')}</p>
        <CopyField value="export OPENAGENTS_API_KEY=oa_pk_…" />
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />{t('hubApps.keysTitle')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('hubApps.keysHint')}{' '}
          <a href={data.docs_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            {t('hubApps.docsLink')}<ExternalLink className="size-3" />
          </a>
        </p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('hubApps.keyNamePlaceholder')} maxLength={80} />
          <Button type="submit" disabled={creating || !name.trim()} className="shrink-0">
            {creating && <Loader2 className="size-4 animate-spin" />}{t('hubApps.createKey')}
          </Button>
        </form>
        {newKey && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
            <p className="text-sm font-medium">{t('hubApps.newKeyTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('hubApps.newKeyHint')}</p>
            <CopyField value={newKey} />
            <p className="pt-1 text-xs font-medium">{t('hubApps.instructionsLabel')}</p>
            <CopyField value={t('hubApps.instructions', { docs: data.docs_url, key: newKey })} />
            <p className="pt-1 text-xs font-medium">{t('hubApps.envLabel')}</p>
            <CopyField value={`export OPENAGENTS_API_KEY=${newKey}`} />
          </div>
        )}
        <ul className="divide-y rounded-md border">
          {data.api_keys.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">{t('hubApps.keysEmpty')}</li>}
          {data.api_keys.map((key) => (
            <li key={key.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{key.name} <code className="ml-1 text-xs text-muted-foreground">{key.prefix}…</code></div>
                <div className="text-xs text-muted-foreground">
                  {t('hubApps.createdOn', { date: date(key.created_at) })} · {key.last_used_at ? t('hubApps.lastUsed', { date: date(key.last_used_at) }) : t('hubApps.neverUsed')}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => revoke(key.id, t('hubApps.revokeConfirm', { name: key.name }))}>{t('hubApps.revoke')}</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

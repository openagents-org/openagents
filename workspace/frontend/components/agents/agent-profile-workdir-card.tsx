'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';
import { FolderPicker } from './agent-setup-folder-picker';
import { ProfileSection } from './agent-profile-section';
import type { NodeAgentSettings } from './use-node-agent-settings';

const HINT = 'text-xs leading-relaxed text-muted-foreground';

/**
 * Where a device agent works, and on which device, changed in place. The
 * device recreates the agent at the new path (see configure_agent in the
 * connector) and carries its key, endpoint and model over. Only the device
 * connection's owner may change its agents, so `settings` is null for anyone
 * else and the card stays read-only.
 */
export function WorkdirCard({ agent, canManage, settings }: {
  agent: WorkspaceAgent;
  canManage: boolean;
  settings: NodeAgentSettings | null;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const node = settings?.node ?? null;
  const current = settings?.nodeAgent?.workingDir || agent.workingDir || '';

  const close = () => { setEditing(false); setBrowsing(false); setError(null); };
  const save = async () => {
    const next = path.trim();
    if (!settings || !node || !next || next === current) { close(); return; }
    setBusy(true);
    setError(null);
    try {
      const outcome = await settings.configure({ workingDir: next });
      toast.success(outcome === 'applied' ? t('agents.settingsSaved') : t('connect.nodeCommandQueued', { node: node.name }));
      close();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('connect.nodeCommandFailed'));
    } finally {
      setBusy(false);
    }
  };

  const editButton = settings && !editing && (
    <Button
      variant="ghost"
      size="xs"
      className="shrink-0 text-muted-foreground"
      disabled={!node}
      onClick={() => { setPath(current); setEditing(true); }}
    >
      <Pencil data-icon="inline-start" />
      {t('agents.settingsEdit')}
    </Button>
  );

  return (
    <ProfileSection title={t('agents.fieldFolder')} action={editButton}>
      {editing && node ? (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-2">
            <div className="flex gap-2">
              <Input
                autoFocus
                value={path}
                onChange={(e) => setPath(e.target.value)}
                aria-label={t('agents.fieldFolder')}
                placeholder={t('agents.workdirPlaceholder')}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={() => setBrowsing((b) => !b)}>{t('connect.nodeBrowse')}</Button>
            </div>
            {browsing && (
              <FolderPicker api={workspaceApi} node={node} onPick={setPath} onClose={() => setBrowsing(false)} />
            )}
            {agent.serverHost && <p className={HINT}>{t('agents.workdirDevice', { device: agent.serverHost })}</p>}
            <p className={HINT}>{t('agents.workdirEditHint')}</p>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close}>{t('common.cancel')}</Button>
              <Button type="submit" size="sm">
                {busy && <Spinner data-icon="inline-start" />}
                {t('common.save')}
              </Button>
            </div>
          </fieldset>
        </form>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-xs break-all">{current || '—'}</div>
          {agent.serverHost && <p className={HINT}>{t('agents.workdirDevice', { device: agent.serverHost })}</p>}
          {!canManage && <p className={HINT}>{t('agents.ownerOnlyHint')}</p>}
        </div>
      )}
    </ProfileSection>
  );
}

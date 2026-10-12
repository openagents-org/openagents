'use client';

import { useEffect, useState } from 'react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { HumanAvatar } from './human-avatar';
import { ThreadPrivacyControl } from './thread-privacy-control';
import { Loader2, Settings, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { threadOwnerEmail } from '@/lib/access-ui';
import { displayNameFromEmail } from '@/lib/collab';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { useT } from '@/lib/i18n';
import type { ChannelParticipants, WorkspaceSession } from '@/lib/types';
import { useThreadAccess } from '@/hooks/use-thread-access';

export function ThreadSettings({ session }: { session: WorkspaceSession }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [participants, setParticipants] = useState<ChannelParticipants | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const { refreshAgents } = useWorkspace();
  const owner = participants?.owner_email || threadOwnerEmail(session);
  const ownerPerson = participants?.humans.find(person => person.email.toLowerCase() === owner?.toLowerCase());
  const access = useThreadAccess(session.sessionId);
  const manage = !!access?.can_manage;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadFailed(false);
    setParticipants(null);
    workspaceApi.getChannelParticipants(session.sessionId)
      .then(data => { if (active) setParticipants(data); })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [open, session.sessionId, attempt]);

  const changePermission = async (kind: 'people' | 'agents', value: boolean) => {
    if (!manage || busy) return;
    setBusy(true);
    try {
      await workspaceApi.updateChannelAccess(session.sessionId, kind === 'people' ? { participantsCanInvite: value } : { membersCanAddAgents: value });
      setParticipants(previous => previous ? { ...previous, [kind === 'people' ? 'participants_can_invite' : 'members_can_add_agents']: value } : previous);
      window.dispatchEvent(new CustomEvent(THREAD_PARTICIPANTS_CHANGED, { detail: session.sessionId }));
      await refreshAgents().catch(() => {});
    } catch { toast.error(t('threadAccess.switchFailed')); }
    finally { setBusy(false); }
  };

  const shareMyAgents = async (mode: 'no' | 'yes' | 'approval') => {
    if (busy || !access?.is_participant) return;
    setBusy(true);
    try {
      await workspaceApi.setThreadAgentSharing(session.sessionId, mode);
      setParticipants(previous => previous ? { ...previous, sharing_my_agents: mode === 'yes', agent_sharing_mode: mode } : previous);
      window.dispatchEvent(new CustomEvent(THREAD_PARTICIPANTS_CHANGED, { detail: session.sessionId }));
      await refreshAgents().catch(() => {});
    } catch { toast.error(t('threadAccess.switchFailed')); }
    finally { setBusy(false); }
  };

  const remove = async (kind: 'human' | 'agent', id: string) => {
    if (!manage || busy) return;
    setBusy(true);
    try {
      if (kind === 'human') await workspaceApi.removeHumanFromChannel(session.sessionId, id);
      else await workspaceApi.removeChannelParticipant(session.sessionId, id);
      setParticipants(previous => previous ? { ...previous,
        humans: kind === 'human' ? previous.humans.filter(human => human.email !== id) : previous.humans,
        agents: kind === 'agent' ? previous.agents.filter(agent => agent.agent_name !== id) : previous.agents,
      } : previous);
      window.dispatchEvent(new CustomEvent(THREAD_PARTICIPANTS_CHANGED, { detail: session.sessionId }));
      await refreshAgents().catch(() => {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('threadSettings.removeFailed'));
    } finally { setBusy(false); }
  };

  if (!access?.is_participant && !access?.can_manage) return null;

  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" title={t('threadSettings.title')} aria-label={t('threadSettings.title')} onClick={() => setOpen(true)}>
        <Settings className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('threadSettings.title')}</DialogTitle>
            <DialogDescription>{t('threadSettings.description')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5 pb-5">
              <p className="truncate text-sm font-medium">{session.title}</p>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm">{t('threadSettings.owner')}</span>
                {owner ? <div className="flex min-w-0 items-center gap-2" title={owner}>
                  <HumanAvatar email={owner} />
                  <span className="truncate text-sm">{ownerPerson?.display_name || displayNameFromEmail(owner)}</span>
                </div> : <span className="text-sm text-muted-foreground">{t('threadSettings.workspaceOwned')}</span>}
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm">{t('threadSettings.visibility')}</span>
                <ThreadPrivacyControl channelName={session.sessionId} inDialog />
              </div>
              {manage && <div className="space-y-4 border-t pt-4">
                <label className="flex items-center justify-between gap-4">
                  <span className="text-sm">{t('threadAccess.participantsCanInvite')}</span>
                  <Switch checked={!!participants?.participants_can_invite} disabled={busy} onCheckedChange={value => void changePermission('people', value)} />
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="text-sm">{t('threadSettings.membersCanAddAgents')}</span>
                  <Switch checked={participants?.members_can_add_agents !== false} disabled={busy} onCheckedChange={value => void changePermission('agents', value)} />
                </label>
              </div>}
              {participants && access?.is_participant && <label className="flex items-center justify-between gap-4 border-t pt-4">
                <span className="text-sm">{t('threadSettings.shareMyAgents')}</span>
                <select aria-label={t('threadSettings.shareMyAgents')} className="rounded-md border bg-background px-2 py-1.5 text-sm" value={participants.agent_sharing_mode || (participants.sharing_my_agents ? 'yes' : 'no')} disabled={busy} onChange={event => void shareMyAgents(event.target.value as 'no' | 'yes' | 'approval')}>
                  <option value="no">{t('threadSettings.sharingNo')}</option>
                  <option value="yes">{t('threadSettings.sharingYes')}</option>
                  <option value="approval">{t('threadSettings.sharingApproval')}</option>
                </select>
              </label>}
              {loadFailed ? <div className="space-y-2 text-sm text-muted-foreground"><p>{t('collab.participantsLoadFailed')}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</Button></div>
                : !participants ? <Loader2 className="size-4 animate-spin" /> : <div className="space-y-4 border-t pt-4">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">{t('threadSettings.people')}</h4>
                    {participants.humans.map(human => <div key={human.email} className="flex items-center gap-2 text-sm">
                      <HumanAvatar email={human.email} /><span className="min-w-0 flex-1 truncate" title={human.email}>{human.display_name || human.email}</span>
                      {manage && human.email.toLowerCase() !== owner?.toLowerCase() && <Button variant="ghost" size="sm" disabled={busy} aria-label={t('threadSettings.remove', { name: human.display_name || human.email })} onClick={() => void remove('human', human.email)}><X className="size-4" /></Button>}
                    </div>)}
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">{t('threadSettings.agents')}</h4>
                    {participants.agents.map(agent => <div key={agent.agent_name} className="flex items-center gap-2 text-sm">
                      <AgentAvatar name={agent.agent_name} size={28} /><div className="min-w-0 flex-1"><p className="truncate">{agent.display_name || agent.agent_name}</p>{agent.owner_email && <p className="truncate text-xs text-muted-foreground">{agent.owner_email}</p>}</div>
                      {manage && <Button variant="ghost" size="sm" disabled={busy} aria-label={t('threadSettings.remove', { name: agent.display_name || agent.agent_name })} onClick={() => void remove('agent', agent.agent_name)}><X className="size-4" /></Button>}
                    </div>)}
                  </div>
                </div>}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

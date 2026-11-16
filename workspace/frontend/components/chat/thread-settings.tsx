'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { HumanAvatar } from './human-avatar';
import { ThreadPrivacyControl } from './thread-privacy-control';
import { Settings, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Field, FieldGroup, FieldLabel, FieldSeparator, FieldTitle } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { threadOwnerEmail } from '@/lib/access-ui';
import { displayNameFromEmail } from '@/lib/collab';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { useT } from '@/lib/i18n';
import type { ChannelParticipants, WorkspaceSession } from '@/lib/types';
import { useThreadAccess } from '@/hooks/use-thread-access';

const THREAD_ICONS = ['💬', '👥', '🤝', '🚀', '💡', '🛠️', '📊', '🎯', '🎨', '📚'];

function ParticipantList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <ItemGroup className="gap-0">{children}</ItemGroup>
    </div>
  );
}

export function ThreadSettings({ session }: { session: WorkspaceSession }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [participants, setParticipants] = useState<ChannelParticipants | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const { refreshAgents, currentUser } = useWorkspace();
  const [iconDraft, setIconDraft] = useState(session.icon || '');
  useEffect(() => { setIconDraft(session.icon || ''); }, [session.icon, open]);
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

  const saveIcon = async (icon: string | null) => {
    if (busy) return;
    setBusy(true);
    try { await workspaceApi.updateChannelAccess(session.sessionId, { icon }); await refreshAgents(); setIconDraft(icon || ''); }
    catch { toast.error(t('threadSettings.iconFailed')); }
    finally { setBusy(false); }
  };

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
      <Button variant="ghost" size="icon-sm" title={t('threadSettings.title')} aria-label={t('threadSettings.title')} onClick={() => setOpen(true)}>
        <Settings />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('threadSettings.title')}</DialogTitle>
            <DialogDescription>{t('threadSettings.description')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FieldGroup>
              <p className="truncate text-sm font-medium">{session.title}</p>
              {owner && currentUser.id.toLowerCase() === owner.toLowerCase() && <Field>
                <FieldLabel htmlFor="thread-icon">{t('threadSettings.icon')}</FieldLabel>
                <ToggleGroup type="single" variant="outline" size="lg" spacing={1} className="flex-wrap" value={session.icon || ''} disabled={busy} onValueChange={icon => { if (icon) void saveIcon(icon); }}>
                  {THREAD_ICONS.map(icon => <ToggleGroupItem key={icon} value={icon} aria-label={icon} className="text-lg">{icon}</ToggleGroupItem>)}
                </ToggleGroup>
                <div className="flex gap-2">
                  <Input id="thread-icon" aria-label={t('threadSettings.icon')} maxLength={32} value={iconDraft} onChange={e => setIconDraft(e.target.value)} className="min-w-0 flex-1" />
                  <Button disabled={busy || !iconDraft.trim()} onClick={() => void saveIcon(iconDraft.trim())}>{t('common.save')}</Button>
                  <Button variant="outline" disabled={busy || !session.icon} onClick={() => void saveIcon(null)}>{t('threadSettings.resetIcon')}</Button>
                </div>
              </Field>}
              <Field orientation="horizontal" className="justify-between">
                <FieldTitle>{t('threadSettings.owner')}</FieldTitle>
                {owner ? <div className="flex min-w-0 items-center gap-2" title={owner}>
                  <HumanAvatar email={owner} />
                  <span className="truncate text-sm">{ownerPerson?.display_name || displayNameFromEmail(owner)}</span>
                </div> : <span className="text-sm text-muted-foreground">{t('threadSettings.workspaceOwned')}</span>}
              </Field>
              <Field orientation="horizontal" className="justify-between">
                <FieldTitle>{t('threadSettings.visibility')}</FieldTitle>
                <ThreadPrivacyControl channelName={session.sessionId} inDialog />
              </Field>
              {manage && <>
                <FieldSeparator />
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="thread-participants-can-invite" className="flex-1 font-normal">{t('threadAccess.participantsCanInvite')}</FieldLabel>
                  <Switch id="thread-participants-can-invite" checked={!!participants?.participants_can_invite} disabled={busy} onCheckedChange={value => void changePermission('people', value)} />
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="thread-members-can-add-agents" className="flex-1 font-normal">{t('threadSettings.membersCanAddAgents')}</FieldLabel>
                  <Switch id="thread-members-can-add-agents" checked={participants?.members_can_add_agents !== false} disabled={busy} onCheckedChange={value => void changePermission('agents', value)} />
                </Field>
              </>}
              {participants && access?.is_participant && <>
                <FieldSeparator />
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="thread-share-my-agents" className="flex-1 font-normal">{t('threadSettings.shareMyAgents')}</FieldLabel>
                  <Select value={participants.agent_sharing_mode || (participants.sharing_my_agents ? 'yes' : 'no')} disabled={busy} onValueChange={value => void shareMyAgents(value as 'no' | 'yes' | 'approval')}>
                    <SelectTrigger id="thread-share-my-agents" aria-label={t('threadSettings.shareMyAgents')} className="w-auto shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="no">{t('threadSettings.sharingNo')}</SelectItem>
                        <SelectItem value="yes">{t('threadSettings.sharingYes')}</SelectItem>
                        <SelectItem value="approval">{t('threadSettings.sharingApproval')}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </>}
              {loadFailed ? <Alert>
                <AlertDescription>{t('collab.participantsLoadFailed')}</AlertDescription>
                <AlertAction><Button variant="outline" size="xs" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</Button></AlertAction>
              </Alert>
                : !participants ? <Spinner /> : <>
                  <FieldSeparator />
                  <ParticipantList title={t('threadSettings.people')}>
                    {participants.humans.map(human => <Item key={human.email} size="xs" className="px-0">
                      <ItemMedia><HumanAvatar email={human.email} /></ItemMedia>
                      <ItemContent><ItemTitle className="truncate" title={human.email}>{human.display_name || human.email}</ItemTitle></ItemContent>
                      {manage && human.email.toLowerCase() !== owner?.toLowerCase() && <ItemActions><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t('threadSettings.remove', { name: human.display_name || human.email })} onClick={() => void remove('human', human.email)}><X /></Button></ItemActions>}
                    </Item>)}
                  </ParticipantList>
                  <ParticipantList title={t('threadSettings.agents')}>
                    {participants.agents.map(agent => <Item key={agent.agent_name} size="xs" className="px-0">
                      <ItemMedia><AgentAvatar name={agent.agent_name} size={28} /></ItemMedia>
                      <ItemContent>
                        <ItemTitle className="truncate">{agent.display_name || agent.agent_name}</ItemTitle>
                        {agent.owner_email && <ItemDescription className="truncate">{agent.owner_email}</ItemDescription>}
                      </ItemContent>
                      {manage && <ItemActions><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t('threadSettings.remove', { name: agent.display_name || agent.agent_name })} onClick={() => void remove('agent', agent.agent_name)}><X /></Button></ItemActions>}
                    </Item>)}
                  </ParticipantList>
                </>}
            </FieldGroup>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

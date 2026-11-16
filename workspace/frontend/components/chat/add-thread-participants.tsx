'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, UserPlus } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Field, FieldLabel } from '@/components/ui/field';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';
import { ParticipantPicker, type ParticipantOption } from '@/components/threads/participant-picker';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useThreadAccess } from '@/hooks/use-thread-access';
import { granteeChipLabel, isExcludedGrantee } from '@/lib/access-ui';
import { addThreadParticipants, THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { useT } from '@/lib/i18n';
import type { ChannelParticipants, Grantee } from '@/lib/types';

export function AddThreadParticipants({ channelName, kind, open: controlledOpen, onOpenChange, hideTrigger = false }: {
  channelName: string;
  kind?: 'human' | 'agent';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const t = useT();
  const { refreshAgents } = useWorkspace();
  const access = useThreadAccess(channelName);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => { setInternalOpen(next); onOpenChange?.(next); };
  const [participants, setParticipants] = useState<ChannelParticipants | null>(null);
  const [options, setOptions] = useState<ParticipantOption[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [picks, setPicks] = useState<Grantee[]>([]);
  const [saving, setSaving] = useState(false);
  const [invites, setInvites] = useState<{ email: string; url: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setParticipants(null);
    setLoadFailed(false);
    Promise.all([
      workspaceApi.getChannelParticipants(channelName),
      workspaceApi.getTeam(),
      workspaceApi.discover(),
    ]).then(([data, people, discovery]) => {
      if (!active) return;
      setOptions([
        ...people.map((person) => ({ kind: 'human' as const, id: person.email.toLowerCase(), label: person.displayName || person.email, detail: person.email })),
        ...discovery.agents.filter((agent) => !agent.builtin && agent.status === 'online').map((agent) => {
          const name = agent.address.replace(/^openagents:/, '');
          return { kind: 'agent' as const, id: name, label: agent.display_name?.trim() || name, detail: t('newThread.agent') };
        }),
      ]);
      setParticipants(data);
    })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [open, channelName, attempt, t]);

  const mayAddPeople = kind !== 'agent' && !!access?.can_add_people;
  const mayAddAgents = kind !== 'human' && !!access?.can_add_agents;
  const mayAdd = mayAddPeople || mayAddAgents;
  const title = t(kind === 'human' ? 'threadAccess.addMember' : kind === 'agent' ? 'threadAccess.addAgent' : 'threadAccess.addParticipants');
  const exclude = [
    ...(participants?.humans.map((p) => `human:${p.email.toLowerCase()}`) ?? []),
    ...(participants?.agents.map((a) => `agent:${a.agent_name}`) ?? []),
  ];

  const available = options.filter((option) =>
    (option.kind === 'human' ? mayAddPeople : mayAddAgents) && !isExcludedGrantee(option, exclude),
  );
  const allowedPicks = picks.filter((pick) => available.some((option) => option.kind === pick.kind && option.id === pick.id));

  const add = async () => {
    if (!mayAdd || !participants || loadFailed || saving || !allowedPicks.length) return;
    setSaving(true);
    try {
      const result = await addThreadParticipants(channelName, allowedPicks);
      setPicks(result.failed);
      setInvites((previous) => [...previous, ...result.invites]);
      for (const person of result.failed) toast.error(t('threadAccess.addFailed', { name: granteeChipLabel(person) }));
      if (result.added.length) {
        toast.success(t('threadAccess.addedParticipants', { count: result.added.length }));
        window.dispatchEvent(new CustomEvent(THREAD_PARTICIPANTS_CHANGED, { detail: channelName }));
        await refreshAgents().catch(() => {});
      }
      if (!result.failed.length && !result.invites.length && !invites.length) setOpen(false);
      else setAttempt((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };

  if (!mayAdd) return null;

  return (
    <>
      {!hideTrigger && <Button variant="ghost" size="icon-sm" title={title} aria-label={title} onClick={() => { setPicks([]); setInvites([]); setOpen(true); }}>
        <UserPlus />
      </Button>}
      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('threadAccess.addParticipantsHint')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {loadFailed ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{t('collab.participantsLoadFailed')}</AlertDescription>
                <AlertAction>
                  <Button variant="outline" size="xs" onClick={() => setAttempt((n) => n + 1)}>{t('common.retry')}</Button>
                </AlertAction>
              </Alert>
            ) : !participants ? <Spinner className="text-muted-foreground" /> : !mayAdd ? (
              <p className="text-sm text-muted-foreground">{t('threadAccess.addForbidden')}</p>
            ) : (
              <ParticipantPicker options={available} value={allowedPicks} onChange={setPicks} disabled={saving} />
            )}
            {invites.map((invite) => (
              <Field key={invite.email}>
                <FieldLabel htmlFor={`invite-${invite.email}`}>{t('collab.inviteLinkReady', { email: invite.email })}</FieldLabel>
                <Input id={`invite-${invite.email}`} readOnly value={invite.url} onFocus={(e) => e.target.select()} />
              </Field>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={!mayAdd || !participants || loadFailed || !allowedPicks.length || saving} onClick={add}>
              {saving ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
              {saving ? t('threadAccess.addingParticipants') : t('threadAccess.addParticipantsButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

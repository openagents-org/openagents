'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';
import { ParticipantPicker, type ParticipantOption } from '@/components/threads/participant-picker';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useThreadAccess } from '@/hooks/use-thread-access';
import { granteeChipLabel, isExcludedGrantee } from '@/lib/access-ui';
import { addThreadParticipants, THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { useT } from '@/lib/i18n';
import type { ChannelParticipants, Grantee } from '@/lib/types';

export function AddThreadParticipants({ channelName }: { channelName: string }) {
  const t = useT();
  const { refreshAgents } = useWorkspace();
  const access = useThreadAccess(channelName);
  const [open, setOpen] = useState(false);
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
        ...discovery.agents.map((agent) => {
          const name = agent.address.replace(/^openagents:/, '');
          return { kind: 'agent' as const, id: name, label: agent.display_name?.trim() || name, detail: t('newThread.agent') };
        }),
      ]);
      setParticipants(data);
    })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [open, channelName, attempt, t]);

  const mayAddPeople = !!access?.can_add_people;
  const mayAddAgents = !!access?.can_add_agents;
  const mayAdd = mayAddPeople || mayAddAgents;
  const title = t('threadAccess.addParticipants');
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
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" title={title} aria-label={title} onClick={() => { setPicks([]); setInvites([]); setOpen(true); }}>
        <UserPlus className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="space-y-2 px-6 pt-6 pb-2">
            <DialogTitle className="text-xl">{title}</DialogTitle>
            <DialogDescription>{t('threadAccess.addParticipantsHint')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3 px-6 py-2">
            {loadFailed ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t('collab.participantsLoadFailed')}</p>
                <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t('common.retry')}</Button>
              </div>
            ) : !participants ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : !mayAdd ? (
              <p className="text-sm text-muted-foreground">{t('threadAccess.addForbidden')}</p>
            ) : (
              <ParticipantPicker options={available} value={allowedPicks} onChange={setPicks} disabled={saving} />
            )}
            {invites.map((invite) => (
              <div key={invite.email} className="space-y-1">
                <p className="text-sm">{t('collab.inviteLinkReady', { email: invite.email })}</p>
                <Input readOnly value={invite.url} onFocus={(e) => e.target.select()} />
              </div>
            ))}
          </DialogBody>
          <DialogFooter className="px-6 pt-3 pb-6 sm:space-x-3">
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={!mayAdd || !participants || loadFailed || !allowedPicks.length || saving} onClick={add}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              {saving ? t('threadAccess.addingParticipants') : t('threadAccess.addParticipantsButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

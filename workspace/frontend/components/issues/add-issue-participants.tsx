'use client';

import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';
import { ParticipantPicker, type ParticipantOption } from '@/components/threads/participant-picker';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { Grantee } from '@/lib/types';
import { ErrorNotice, errorMessage } from './issue-ui';

export function AddIssueParticipants({ issueId, existing, onAdded }: {
  issueId: string; existing: string[]; onAdded: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ParticipantOption[] | null>(null);
  const [picks, setPicks] = useState<Grantee[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setOptions(null);
    setError('');
    Promise.all([workspaceApi.getTeam(), workspaceApi.discover()]).then(([team, discovery]) => {
      if (!active) return;
      setOptions([
        ...team.map((person) => ({ kind: 'human' as const, id: person.email.toLowerCase(), label: person.displayName || person.email, detail: person.email })),
        ...discovery.agents.filter((agent) => !agent.builtin && agent.status === 'online').map((agent) => {
          const id = agent.address.replace(/^openagents:/, '');
          return { kind: 'agent' as const, id, label: agent.display_name?.trim() || id, detail: t('newThread.agent') };
        }),
      ]);
    }).catch((e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [open, attempt, t]);

  const available = (options || []).filter((p) => !existing.includes(`${p.kind === 'human' ? 'human' : 'openagents'}:${p.id}`));
  const selected = picks.filter((p) => available.some((a) => a.kind === p.kind && a.id === p.id));
  async function add() {
    if (saving || !selected.length) return;
    setSaving(true);
    setError('');
    try {
      await workspaceApi.addIssueParticipants(issueId, selected.filter((p): p is Grantee & { kind: 'human' | 'agent' } => p.kind === 'human' || p.kind === 'agent'));
      onAdded();
      setOpen(false);
    } catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  }

  return <>
    <Button variant="ghost" size="sm" className="shrink-0" onClick={() => { setPicks([]); setOpen(true); }}>
      <UserPlus data-icon="inline-start" />{t('threadAccess.addParticipants')}
    </Button>
    <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('threadAccess.addParticipants')}</DialogTitle>
          <DialogDescription>{t('issues.addParticipantsHint')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {options ? <ParticipantPicker options={available} value={selected} onChange={setPicks} disabled={saving} />
            : !error && <Spinner />}
          {error && <ErrorNotice message={error} />}
          {!options && error && <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>{t('common.retry')}</Button>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button disabled={!options || !selected.length || saving} onClick={add}>
            {saving ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
            {t('issues.addParticipantsButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

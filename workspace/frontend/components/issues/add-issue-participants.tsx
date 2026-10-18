'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
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
        ...discovery.agents.filter((agent) => agent.status === 'online').map((agent) => {
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
    <Button variant="outline" size="sm" className="mt-4 w-full justify-start text-xs" onClick={() => { setPicks([]); setOpen(true); }}>
      <UserPlus className="size-3.5" />{t('threadAccess.addParticipants')}
    </Button>
    <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('threadAccess.addParticipants')}</DialogTitle>
          <DialogDescription>{t('issues.addParticipantsHint')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {options ? <ParticipantPicker options={available} value={selected} onChange={setPicks} disabled={saving} />
            : !error && <Loader2 className="size-4 animate-spin" />}
          {error && <ErrorNotice message={error} />}
          {!options && error && <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>{t('common.retry')}</Button>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button disabled={!options || !selected.length || saving} onClick={add}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            {t('issues.addParticipantsButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

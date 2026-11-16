'use client';

// ── v1.1 permission model — Settings → Admin → Private threads ───────────────
// Metadata only (GET /admin/private-threads): admins see that a private
// thread exists, who owns it and how active it is — never its content. The
// one action is "Transfer owner" (PATCH owner_email), for when someone leaves.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Lock } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import {
  SelectGroup, Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import { useFormatters, useT } from '@/lib/i18n';
import { displayNameFromEmail } from '@/lib/collab';
import type { PrivateThreadMeta, TeamMember } from '@/lib/types';

export default function PrivateThreadsSettingsPage() {
  const { me } = useAdminSettings();
  const t = useT();
  const { timeAgo } = useFormatters();
  const editable = canAdminister(me);

  const [threads, setThreads] = useState<PrivateThreadMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [transferring, setTransferring] = useState<PrivateThreadMeta | null>(null);

  const load = useCallback(async () => {
    if (!editable) { setThreads([]); return; }
    try {
      const [list, team] = await Promise.all([
        workspaceApi.listPrivateThreadsAdmin(),
        workspaceApi.getTeam().catch(() => [] as TeamMember[]),
      ]);
      setThreads(list);
      setMembers(team);
      setFailed(false);
    } catch {
      setThreads([]);
      setFailed(true);
    }
  }, [editable]);
  useEffect(() => { load(); }, [load]);

  const memberName = useCallback((email: string | null) => {
    if (!email) return t('adminThreads.noOwner');
    return members.find((m) => m.email.toLowerCase() === email.toLowerCase())?.displayName || displayNameFromEmail(email);
  }, [members, t]);

  const sorted = useMemo(() => (threads || []).slice().sort((a, b) => {
    const ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
    const tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
    return tb - ta;
  }), [threads]);

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title={t('adminThreads.title')} description={t('adminThreads.description')} />
      {!editable && <ReadOnlyBanner />}

      {!editable ? (
        <p className="text-sm text-muted-foreground">{t('adminThreads.adminOnly')}</p>
      ) : threads === null ? (
        <div className="flex items-center justify-center py-10">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : failed ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive">{t('adminThreads.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={load}>{t('common.retry')}</Button>
        </div>
      ) : sorted.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t('adminThreads.empty')}</p>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>{t('adminThreads.colTitle')}</TableHead>
                <TableHead>{t('adminThreads.colOwner')}</TableHead>
                <TableHead className="text-right">{t('adminThreads.colParticipants')}</TableHead>
                <TableHead className="text-right">{t('adminThreads.colMessages')}</TableHead>
                <TableHead>{t('adminThreads.colLastActivity')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((th) => (
                <TableRow key={th.name}>
                  <TableCell className="max-w-72">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      <Lock className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{th.title?.trim() || t('adminThreads.untitled')}</span>
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground" title={th.name}>{th.name}</p>
                  </TableCell>
                  <TableCell className="max-w-56">
                    <p className="truncate">{memberName(th.owner_email)}</p>
                    {th.owner_email && <p className="truncate text-xs text-muted-foreground">{th.owner_email}</p>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{th.participant_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{th.message_count}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {th.last_activity_at ? timeAgo(th.last_activity_at) : t('adminThreads.never')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setTransferring(th)}>
                      <ArrowRightLeft data-icon="inline-start" />
                      {t('adminThreads.transfer')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {transferring && (
        <TransferOwnerDialog
          thread={transferring}
          members={members}
          onClose={() => setTransferring(null)}
          onDone={async () => { setTransferring(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── Transfer owner ───────────────────────────────────────────────────────────

function TransferOwnerDialog({
  thread,
  members,
  onClose,
  onDone,
}: {
  thread: PrivateThreadMeta;
  members: TeamMember[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const current = (thread.owner_email || '').toLowerCase();
  const candidates = members.filter((m) => m.email.toLowerCase() !== current);
  const [email, setEmail] = useState<string>(candidates[0]?.email || '');
  const [busy, setBusy] = useState(false);

  const transfer = async () => {
    if (!email || busy) return;
    setBusy(true);
    try {
      await workspaceApi.transferThread(thread.name, email);
      const m = members.find((x) => x.email === email);
      toast.success(t('adminThreads.transferred', { name: m?.displayName || displayNameFromEmail(email) }));
      await onDone();
    } catch {
      toast.error(t('adminThreads.transferFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t('adminThreads.transferTitle', { title: thread.title?.trim() || t('adminThreads.untitled') })}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t('adminThreads.transferDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          <Label className="font-normal">{t('adminThreads.newOwner')}</Label>
          <Select value={email} onValueChange={setEmail}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>{candidates.map((m) => (
                <SelectItem key={m.email} value={m.email}>
                  {m.displayName ? `${m.displayName} · ${m.email}` : m.email}
                </SelectItem>
              ))}</SelectGroup>
            </SelectContent>
          </Select>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" className="min-w-24" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={transfer} disabled={busy || !email}>
            {busy ? <Spinner /> : <ArrowRightLeft className="size-4" />}
            {t('adminThreads.transferConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

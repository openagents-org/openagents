'use client';

// ── v1.1 permission model — Settings → Admin → Private threads ───────────────
// Metadata only (GET /admin/private-threads): admins see that a private
// thread exists, who owns it and how active it is — never its content. The
// one action is "Transfer owner" (PATCH owner_email), for when someone leaves.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
  Select,
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
    <div className="space-y-8">
      <SectionHeader title={t('adminThreads.title')} description={t('adminThreads.description')} />
      {!editable && <ReadOnlyBanner />}

      {!editable ? (
        <p className="text-sm text-muted-foreground">{t('adminThreads.adminOnly')}</p>
      ) : threads === null ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : failed ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive">{t('adminThreads.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={load}>{t('common.retry')}</Button>
        </div>
      ) : sorted.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t('adminThreads.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('adminThreads.colTitle')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('adminThreads.colOwner')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('adminThreads.colParticipants')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('adminThreads.colMessages')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('adminThreads.colLastActivity')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((th) => (
                <tr key={th.name} className="hover:bg-muted/30">
                  <td className="max-w-[18rem] px-3 py-2">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      <Lock className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{th.title?.trim() || t('adminThreads.untitled')}</span>
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground" title={th.name}>{th.name}</p>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2">
                    <p className="truncate">{memberName(th.owner_email)}</p>
                    {th.owner_email && <p className="truncate text-xs text-muted-foreground">{th.owner_email}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{th.participant_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{th.message_count}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {th.last_activity_at ? timeAgo(th.last_activity_at) : t('adminThreads.never')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => setTransferring(th)}>
                      <ArrowRightLeft className="size-3.5" />
                      {t('adminThreads.transfer')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <DialogHeader className="space-y-3 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">
            {t('adminThreads.transferTitle', { title: thread.title?.trim() || t('adminThreads.untitled') })}
          </DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {t('adminThreads.transferDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2 px-7 py-2">
          <Label variant="secondary">{t('adminThreads.newOwner')}</Label>
          <Select value={email} onValueChange={setEmail}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.email} value={m.email}>
                  {m.displayName ? `${m.displayName} · ${m.email}` : m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DialogBody>
        <DialogFooter className="px-7 pt-7 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={transfer} disabled={busy || !email}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
            {t('adminThreads.transferConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

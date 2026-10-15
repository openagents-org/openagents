'use client';

import { useEffect, useState } from 'react';
import { Check, Lock, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { useMe } from '@/hooks/use-me';
import { useFormatters, useT } from '@/lib/i18n';
import { approvalActionBlockedReason, canActOnApproval } from '@/lib/approvals';
import { roleLabel } from '@/lib/roles';
import type { MessageKey } from '@/lib/i18n/translate';
import type { ApprovalRequest } from '@/lib/types';

const KIND_KEYS: Record<string, MessageKey> = {
  service_request: 'approvals.kinds.service_request',
  agent_sharing_request: 'approvals.kinds.agentAccess',
  thread_agent_request: 'approvals.kinds.agentAccess',
  issue_agent_request: 'approvals.kinds.agentAccess',
  deploy: 'approvals.kinds.deploy',
  spend: 'approvals.kinds.spend',
  external_send: 'approvals.kinds.external_send',
  repo_read: 'approvals.kinds.repo_read',
  repo_write: 'approvals.kinds.repo_write',
  data_delete: 'approvals.kinds.data_delete',
  shell: 'approvals.kinds.shell',
  other: 'approvals.kinds.generic',
};

type Busy = 'approve' | 'reject' | null;

/**
 * The approval gate, rendered where the work is — inline in the thread, and
 * (v1.1) expanded from an inbox row.
 *
 * The card starts from the snapshot the agent's message carried, then tracks
 * the live record: while the workspace still lists this id as pending it stays
 * actionable; the moment it disappears from that list (someone else decided,
 * or policy did) the card refetches once and shows the verdict.
 */
export function ApprovalCard({
  approval: initial,
  onResolved,
}: {
  approval: ApprovalRequest;
  /** Called with the fresh record after this card records a decision. */
  onResolved?: (approval: ApprovalRequest) => void;
}) {
  const t = useT();
  const { formatTime } = useFormatters();
  const { workspace, pendingApprovals, refreshApprovals } = useWorkspace();
  const team = useTeamRoster();
  const personName = (email: string) => team.find(person => person.email.toLowerCase() === email.replace(/^human:/, '').toLowerCase())?.displayName || email;
  const me = useMe(workspace?.slug || workspace?.workspaceId);

  const [approval, setApproval] = useState(initial);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);

  // Live status: pending list is the cheap signal; the record is the truth.
  const stillPending = pendingApprovals.some((a) => a.id === approval.id);
  useEffect(() => {
    if (approval.status !== 'pending') return;
    const pending = pendingApprovals.find((a) => a.id === approval.id);
    if (pending) {
      setApproval(pending);
      return;
    }
    let cancelled = false;
    workspaceApi.getApproval(approval.id)
      .then((fresh) => { if (!cancelled && fresh.status !== 'pending') setApproval(fresh); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApprovals, stillPending, approval.status, approval.id]);

  const requireLogin = Boolean(workspace?.requireLogin);
  const canDecide = canActOnApproval(me, approval, requireLogin);
  const blocked = approvalActionBlockedReason(me, approval, requireLogin);

  const baseRoleText = approval.requiredRole === 'admin'
    ? t('approvals.roleAdmin')
    : approval.requiredRole === 'owner' ? t('approvals.roleOwner') : t('approvals.roleAny');

  const requirements = approval.policyRequirements;
  const roleText = requirements?.members.length ? requirements.members.map(personName).join(', ') + (requirements.role_required ? ` + ${baseRoleText}` : '') : baseRoleText;

  // Who this is for: the named assignee, else the agent's owner, else the role.
  const addressee = approval.assigneeEmail ?? approval.ownerEmail ?? null;
  const addresseeText = addressee ? personName(addressee) : roleText;
  const myEmail = me?.email?.trim().toLowerCase() ?? null;

  const whoResolved = approval.resolvedBy === 'token' ? t('approvals.tokenHolder') : personName(approval.resolvedBy || '');

  const finish = (fresh: ApprovalRequest) => {
    setApproval(fresh);
    setNote('');
    setShowNote(false);
    refreshApprovals().catch(() => {});
    onResolved?.(fresh);
  };

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : '';
    toast.error(msg.includes('requires')
      ? t('approvals.roleHint', { role: roleText, yours: roleLabel(t, me?.role) || '—' })
      : t('approvals.failed'));
  };

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    try {
      finish(await workspaceApi.resolveApproval(approval.id, decision, note.trim() || undefined));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const kindLabel = t(KIND_KEYS[approval.kind] ?? 'approvals.kinds.generic');

  const isPending = approval.status === 'pending';
  const verdictTone = approval.status === 'approved'
    ? 'text-emerald-700 dark:text-emerald-400'
    : approval.status === 'rejected' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';

  // ---- Header ----------------------------------------------------------------
  const headerText = `${t('approvals.requested')} · ${approval.action}`;

  // ---- Verdict line ------------------------------------------------------------
  const verdictText = (() => {
    if (isPending) return null;
    if (approval.resolvedBy === 'policy') {
      return approval.status === 'approved' ? t('approvals.autoApproved') : t('approvals.autoRejected');
    }
    if (approval.status === 'expired') return t('approvals.expired');
    const ok = approval.status === 'approved';
    return ok ? t('approvals.approvedBy', { who: whoResolved }) : t('approvals.rejectedBy', { who: whoResolved });
  })();

  const blockedHint = requirements?.approved_by.includes(myEmail || '')
    ? t('approvals.yourApprovalRecorded')
    : requirements?.members.length && blocked
    ? t('approvals.waitingReviewers', { people: roleText })
    : blocked === 'signIn'
    ? t('approvals.signInHint')
    : blocked === 'assignee'
      ? t('approvals.assigneeHint', { who: addresseeText })
      : t('approvals.roleHint', { role: roleText, yours: roleLabel(t, me?.role) || '—' });

  return (
    <div
      className={cn(
        'mt-1.5 max-w-xl overflow-hidden rounded-xl border bg-card text-sm shadow-sm',
        isPending ? 'border-amber-300/70 dark:border-amber-500/40' : 'border-border',
      )}
      data-testid="approval-card"
      data-kind-class="approval"
    >
      {/* Header */}
      <div className={cn(
        'flex items-center gap-2 px-3.5 py-2 text-xs font-semibold',
        isPending ? 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-muted/60 text-foreground',
      )}>
        <Lock className="size-3.5 shrink-0" />
        <span className="truncate">{headerText}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {kindLabel}
          </span>
          {approval.risk && (
            <span className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              approval.risk === 'high'
                ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                : approval.risk === 'medium'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
            )}>
              {approval.risk} {t('approvals.risk')}
            </span>
          )}
        </span>
      </div>

      {/* Body */}
      <div className="space-y-2.5 px-3.5 py-3">
        {approval.details && (
          <pre className={cn(
            'max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2.5 py-2 font-mono text-[12px] leading-relaxed',
            'text-foreground/90',
          )}>
            {approval.details}
          </pre>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="size-3.5" />
            {t('approvals.needs', { role: roleText })}
          </span>
          {approval.requesterEmail && (
            <span>{t('approvals.onBehalfOf', { who: personName(approval.requesterEmail) })}</span>
          )}
          {verdictText && (
            <span className={cn('font-medium', verdictTone)}>
              {verdictText}
              {approval.resolvedAt && <span className="font-normal text-muted-foreground"> · {formatTime(approval.resolvedAt)}</span>}
            </span>
          )}
        </div>

        {!isPending && approval.note && approval.resolvedBy !== 'policy' && (
          <p className="text-xs italic text-muted-foreground">“{approval.note}”</p>
        )}

        {!!requirements?.approved_by.length && <p className="text-xs text-muted-foreground">{t('approvals.reviewedBy', { people: requirements.approved_by.map(personName).join(', ') })}</p>}
        {/* Decision */}
        {isPending && canDecide && (
          <div className="space-y-2 pt-0.5">
            {showNote && (
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('approvals.notePlaceholder')}
                rows={2}
                className="text-sm"
              />
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-8 gap-1.5" disabled={busy !== null} onClick={() => decide('approve')}>
                <Check className="size-3.5" />
                {busy === 'approve'
                  ? t('approvals.sending')
                  : t('approvals.approve')}
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy !== null} onClick={() => decide('reject')}>
                <X className="size-3.5" />
                {busy === 'reject'
                  ? t('approvals.sending')
                  : t('approvals.reject')}
              </Button>
              {!showNote && (
                <button
                  type="button"
                  onClick={() => setShowNote(true)}
                  className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t('approvals.addNote')}
                </button>
              )}
            </div>
          </div>
        )}
        {isPending && !canDecide && (
          <p className="text-xs text-muted-foreground">{blockedHint}</p>
        )}
      </div>
    </div>
  );
}

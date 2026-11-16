'use client';

import { useEffect, useState } from 'react';
import { Check, Lock, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { useMe } from '@/hooks/use-me';
import { useFormatters, useT } from '@/lib/i18n';
import { approvalActionBlockedReason, canActOnApproval, normalizePolicyRequirements } from '@/lib/approvals';
import { roleLabel } from '@/lib/roles';
import type { MessageKey } from '@/lib/i18n/translate';
import type { ApprovalRequest } from '@/lib/types';

const KIND_KEYS: Record<string, MessageKey> = {
  service_request: 'approvals.kinds.service_request',
  agent_sharing_request: 'approvals.kinds.agentAccess',
  public_share_request: 'approvals.kinds.publicShare',
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

  const requirements = normalizePolicyRequirements(approval.policyRequirements);
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
    ? 'text-success'
    : approval.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground';

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

  const riskVariant = approval.risk === 'high' ? 'destructive' : approval.risk === 'medium' ? 'warning' : 'secondary';

  return (
    <Card
      size="sm"
      className={cn('mt-1.5 max-w-xl gap-0 py-0 shadow-sm', isPending && 'ring-warning/70')}
      data-testid="approval-card"
      data-kind-class="approval"
    >
      {/* Header */}
      <CardHeader className={cn(
        'flex items-center gap-2 py-2 text-xs font-semibold',
        isPending ? 'bg-warning/10 text-warning' : 'bg-muted/60 text-foreground',
      )}>
        <Lock aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{headerText}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="bg-background/70 tracking-wide text-muted-foreground uppercase">{kindLabel}</Badge>
          {approval.risk && (
            <Badge variant={riskVariant} className="tracking-wide uppercase">
              {approval.risk} {t('approvals.risk')}
            </Badge>
          )}
        </span>
      </CardHeader>

      {/* Body */}
      <CardContent className="flex flex-col gap-2.5 py-3">
        {approval.details && (
          <pre className="max-h-48 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90 wrap-break-word">
            {approval.details}
          </pre>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ShieldAlert aria-hidden="true" className="size-3.5" />
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
          <p className="text-xs text-muted-foreground italic">“{approval.note}”</p>
        )}

        {!!requirements?.approved_by.length && <p className="text-xs text-muted-foreground">{t('approvals.reviewedBy', { people: requirements.approved_by.map(personName).join(', ') })}</p>}
        {/* Decision */}
        {isPending && canDecide && (
          <div className="flex flex-col gap-2 pt-0.5">
            {showNote && (
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('approvals.notePlaceholder')}
                rows={2}
              />
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => decide('approve')}>
                {busy === 'approve' ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                {busy === 'approve'
                  ? t('approvals.sending')
                  : t('approvals.approve')}
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide('reject')}>
                {busy === 'reject' ? <Spinner data-icon="inline-start" /> : <X data-icon="inline-start" />}
                {busy === 'reject'
                  ? t('approvals.sending')
                  : t('approvals.reject')}
              </Button>
              {!showNote && (
                <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setShowNote(true)}>
                  {t('approvals.addNote')}
                </Button>
              )}
            </div>
          </div>
        )}
        {isPending && !canDecide && (
          <p className="text-xs text-muted-foreground">{blockedHint}</p>
        )}
      </CardContent>
    </Card>
  );
}

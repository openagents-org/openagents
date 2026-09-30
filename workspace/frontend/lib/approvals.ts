import type { ApprovalKindClass, ApprovalRequest, ApprovalRequiredRole, WorkspaceMe, WorkspaceRole } from './types';

/**
 * Pure helpers for the approval gate — kept framework-free so the decision
 * logic can be unit-tested and shared by the chat card, the inbox and the
 * settings page.
 */

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
const REQUIRED_MIN_ROLE: Record<ApprovalRequiredRole, WorkspaceRole> = {
  any: 'member',
  admin: 'admin',
  owner: 'owner',
};

/**
 * Can this caller press Approve / Reject on a request that needs
 * `requiredRole`? Mirrors the backend rule exactly:
 *   - a signed-in member whose identity role meets the bar → yes
 *   - a bare workspace-token visitor → only on a legacy workspace that does
 *     not enforce login (there is no identity to check there; on an enforced
 *     workspace the token is the agents' credential and must not self-approve)
 */
export function canDecideApproval(
  me: Pick<WorkspaceMe, 'role' | 'tokenAccess'> | null | undefined,
  requiredRole: ApprovalRequiredRole,
  requireLogin: boolean,
): boolean {
  if (!me) return false;
  const min = REQUIRED_MIN_ROLE[requiredRole] ?? 'member';
  if (me.role && ROLE_RANK[me.role] >= ROLE_RANK[min]) return true;
  return Boolean(me.tokenAccess) && !requireLogin;
}

/** Why the buttons are hidden — for the hint under a card. */
export function approvalBlockedReason(
  me: Pick<WorkspaceMe, 'role' | 'tokenAccess'> | null | undefined,
  requiredRole: ApprovalRequiredRole,
  requireLogin: boolean,
): 'signIn' | 'role' | null {
  if (canDecideApproval(me, requiredRole, requireLogin)) return null;
  if (!me?.role) return 'signIn';
  return 'role';
}

/**
 * Card class of a request: policy kinds collapse to `approval`; the v1.1
 * escalation kinds render as a question (`help`) or a proposed change to the
 * agent's shared instructions (`proposal`). Older thread snapshots predate
 * `kind_class`, so the kind itself is the fallback.
 */
export function approvalKindClass(kindClass: unknown, kind: unknown): ApprovalKindClass {
  if (kindClass === 'help' || kindClass === 'proposal' || kindClass === 'approval') return kindClass;
  return kind === 'help' || kind === 'proposal' ? kind : 'approval';
}

const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

/**
 * Can this caller act on *this* request? On top of the role bar
 * (`canDecideApproval`), a request addressed to someone (`assigneeEmail` —
 * help/proposal default to the agent's owner) narrows to that person or an
 * admin/owner, as the backend does; a legacy token visitor on an open
 * workspace (no identity at all) still may.
 */
export function canActOnApproval(
  me: Pick<WorkspaceMe, 'role' | 'tokenAccess' | 'email'> | null | undefined,
  approval: Pick<ApprovalRequest, 'requiredRole' | 'assigneeEmail'>,
  requireLogin: boolean,
): boolean {
  if (!canDecideApproval(me, approval.requiredRole, requireLogin)) return false;
  if (!approval.assigneeEmail) return true;
  if (sameEmail(me?.email, approval.assigneeEmail)) return true;
  if (me?.role && ROLE_RANK[me.role] >= ROLE_RANK.admin) return true;
  return Boolean(me?.tokenAccess) && !requireLogin && !me?.role;
}

/** Why the buttons are hidden on this request — `assignee` = it is someone else's to answer. */
export function approvalActionBlockedReason(
  me: Pick<WorkspaceMe, 'role' | 'tokenAccess' | 'email'> | null | undefined,
  approval: Pick<ApprovalRequest, 'requiredRole' | 'assigneeEmail'>,
  requireLogin: boolean,
): 'signIn' | 'role' | 'assignee' | null {
  if (canActOnApproval(me, approval, requireLogin)) return null;
  return approvalBlockedReason(me, approval.requiredRole, requireLogin) ?? 'assignee';
}

/** Read the approval record an event carried in its payload, if any. */
export function approvalFromMetadata(metadata: Record<string, unknown> | undefined | null): ApprovalRequest | null {
  const raw = metadata?.approval as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const kind = String(raw.kind ?? 'other');
  return {
    id: String(raw.id),
    channelName: String(raw.channel_name ?? ''),
    requestedBy: String(raw.requested_by ?? ''),
    kind,
    kindClass: approvalKindClass(raw.kind_class, kind),
    action: String(raw.action ?? ''),
    question: kind === 'help' ? (String(raw.question ?? raw.action ?? '') || null) : null,
    details: (raw.details as string) ?? null,
    risk: (raw.risk as ApprovalRequest['risk']) ?? null,
    requiredRole: (raw.required_role as ApprovalRequiredRole) ?? 'any',
    assigneeEmail: (raw.assignee_email as string) ?? null,
    ownerEmail: (raw.owner_email as string) ?? null,
    requesterEmail: (raw.requester_email as string) ?? null,
    status: (raw.status as ApprovalRequest['status']) ?? 'pending',
    resolvedBy: (raw.resolved_by as string) ?? null,
    resolvedByRole: (raw.resolved_by_role as string) ?? null,
    resolvedAt: (raw.resolved_at as string) ?? null,
    note: (raw.note as string) ?? null,
    requestEventId: (raw.request_event_id as string) ?? null,
    resolutionEventId: (raw.resolution_event_id as string) ?? null,
    createdAt: (raw.created_at as string) ?? null,
  };
}

/** Agent presence for the roster: a pending request means "waiting". */
export function agentPresence(
  status: string | null | undefined,
  pendingByAgent: Record<string, number> | undefined,
  agentName: string,
): 'online' | 'offline' | 'waiting' {
  if ((pendingByAgent?.[agentName] ?? 0) > 0) return 'waiting';
  return status === 'online' ? 'online' : 'offline';
}

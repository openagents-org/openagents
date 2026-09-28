import type { ApprovalRequest, ApprovalRequiredRole, WorkspaceMe, WorkspaceRole } from './types';

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

/** Read the approval record an event carried in its payload, if any. */
export function approvalFromMetadata(metadata: Record<string, unknown> | undefined | null): ApprovalRequest | null {
  const raw = metadata?.approval as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: String(raw.id),
    channelName: String(raw.channel_name ?? ''),
    requestedBy: String(raw.requested_by ?? ''),
    kind: String(raw.kind ?? 'other'),
    action: String(raw.action ?? ''),
    details: (raw.details as string) ?? null,
    risk: (raw.risk as ApprovalRequest['risk']) ?? null,
    requiredRole: (raw.required_role as ApprovalRequiredRole) ?? 'any',
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

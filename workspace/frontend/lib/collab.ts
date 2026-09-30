// ── v1.1 M1/M2 — pure helpers for mixed human–agent collaboration ────────────
// Availability, cost-owner and permission mapping shared by the roster, the
// members page, the share dialog and the agent directory. Framework-free so
// it can be unit-tested (see collab.test.ts).

import type { AgentRuntimeStatus, CostOwner, WorkspaceMe, WorkspaceRole } from './types';
import type { TranslateFn } from './i18n';

/**
 * One word for "can I hand this agent work right now?".
 *
 *  - `waiting`        an approval/help request of the agent is pending on a person
 *  - `device_offline` the node the agent runs on is unreachable (distinct from
 *                     the agent itself having gone quiet — the fix is elsewhere)
 *  - `offline`        the agent process is not connected
 *  - `busy`           connected but working / queueing requests
 *  - `online`         idle and ready
 */
export type AgentAvailability = 'online' | 'busy' | 'waiting' | 'offline' | 'device_offline';

export interface AvailabilityInput {
  status: string | null | undefined;
  runtimeStatus?: AgentRuntimeStatus;
  presenceState?: string | null;
  queueDepth?: number | null;
  busyChannels?: string[] | null;
}

const BUSY_STATES = new Set(['busy', 'working', 'queued', 'running']);

export function agentAvailability(a: AvailabilityInput, pendingApprovals = 0): AgentAvailability {
  if (pendingApprovals > 0 || a.presenceState === 'waiting') return 'waiting';
  if (a.runtimeStatus === 'offline') return 'device_offline';
  if (a.status !== 'online') return 'offline';
  if (
    (a.presenceState && BUSY_STATES.has(a.presenceState)) ||
    (a.queueDepth ?? 0) > 0 ||
    (a.busyChannels?.length ?? 0) > 0
  ) return 'busy';
  return 'online';
}

/** The availability as a short label, in the reader's language. */
export function availabilityLabel(t: TranslateFn, availability: AgentAvailability, queueDepth = 0): string {
  switch (availability) {
    case 'online': return t('collab.online');
    case 'busy': return queueDepth > 0 ? t('collab.busyQueued', { count: queueDepth }) : t('collab.busy');
    case 'waiting': return t('collab.waiting');
    case 'device_offline': return t('collab.deviceOffline');
    default: return t('collab.agentOffline');
  }
}

/** Dot colour for an availability, matching the roster's existing palette
 * (green online, amber waiting, grey offline). Busy is blue so it doesn't read
 * as "needs you". */
export function availabilityDotClass(availability: AgentAvailability): string {
  switch (availability) {
    case 'online': return 'bg-green-500';
    case 'busy': return 'bg-sky-500';
    case 'waiting': return 'bg-amber-400';
    case 'device_offline': return 'bg-zinc-300 dark:bg-zinc-600 ring-2 ring-rose-400/40';
    default: return 'bg-zinc-300 dark:bg-zinc-600';
  }
}

/** Which "whose credits" sentence to show, resolved for the viewer. */
export type CostOwnerDescriptor =
  | { kind: 'owner'; owner: string }
  | { kind: 'workspace' }
  | { kind: 'yours' };

export function costOwnerDescriptor(
  costOwner: CostOwner | null | undefined,
  ownerEmail: string | null | undefined,
  ownerDisplay: string | null | undefined,
  viewerEmail: string | null | undefined,
): CostOwnerDescriptor {
  const owner = (ownerEmail || '').trim().toLowerCase();
  const viewer = (viewerEmail || '').trim().toLowerCase();
  if (costOwner === 'workspace') return { kind: 'workspace' };
  if (costOwner === 'requester') return { kind: 'yours' };
  // 'owner' (or undeclared): the owner pays — which is "you" when you own it.
  if (!owner) return { kind: 'workspace' };
  if (viewer && owner === viewer) return { kind: 'yours' };
  return { kind: 'owner', owner: ownerDisplay?.trim() || displayNameFromEmail(owner) };
}

/** `jane.doe@x.com` → `jane.doe`; already-a-name strings pass through. */
export function displayNameFromEmail(value: string | null | undefined): string {
  if (!value) return '';
  const at = value.indexOf('@');
  return at > 0 ? value.slice(0, at) : value;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Admin-or-above, or the agent's own owner. Mirrors the server rule so the
 * UI can hide controls it knows will 403. */
export function canManageAgent(
  me: Pick<WorkspaceMe, 'email' | 'effectiveRole'> | null | undefined,
  agentOwnerEmail: string | null | undefined,
): boolean {
  if (!me) return false;
  if (me.effectiveRole && ROLE_RANK[me.effectiveRole] >= ROLE_RANK.admin) return true;
  const mine = (me.email || '').trim().toLowerCase();
  return !!mine && mine === (agentOwnerEmail || '').trim().toLowerCase();
}

/** A member may claim an agent nobody owns yet (server: owner_email = self). */
export function canClaimAgent(
  me: Pick<WorkspaceMe, 'email'> | null | undefined,
  agentOwnerEmail: string | null | undefined,
): boolean {
  return !!me?.email && !(agentOwnerEmail || '').trim();
}

/** The HTTP status hidden in `API 403: {...}` errors thrown by WorkspaceApi. */
export function apiErrorStatus(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const m = /^API (\d{3})\b/.exec(msg);
  return m ? Number(m[1]) : null;
}

/** Directory order: pinned first, then available before unavailable, then name. */
export function sortDirectory<T extends { pinned: boolean; display_name: string | null; agent_name: string } & AvailabilityInput>(entries: T[]): T[] {
  const rank: Record<AgentAvailability, number> = { online: 0, busy: 1, waiting: 2, device_offline: 3, offline: 4 };
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ra = rank[agentAvailability(a)];
    const rb = rank[agentAvailability(b)];
    if (ra !== rb) return ra - rb;
    return (a.display_name || a.agent_name).localeCompare(b.display_name || b.agent_name);
  });
}

/** Textarea → list: one entry per non-blank line, trimmed. */
export function linesToList(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ── v1.1 permission model — pure UI helpers ──────────────────────────────────
// Visibility wording, who-may-manage rules and grantee chip formatting shared
// by the thread header, the share dialog, the new-thread dialog, the Groups
// tab and the admin private-threads page. Framework-free so it can be unit
// tested (see access-ui.test.ts). Spec: workspace/docs/permission-model-v1.md.

import type {
  Grantee,
  GranteeKind,
  GroupMember,
  ResourceGrant,
  SecurityGroup,
  WorkspaceMe,
  WorkspaceRole,
} from './types';
import { displayNameFromEmail } from './collab';

/** The two levels the UI speaks. */
export type ThreadVisibility = 'private' | 'public';

/**
 * Backend → UI. The API used to say 'workspace' for a thread everyone can see;
 * the permission model renamed that to 'public' (and keeps accepting the old
 * word on input). Anything that is not explicitly private reads as public.
 */
export function normalizeThreadVisibility(value: string | null | undefined): ThreadVisibility {
  return value === 'private' ? 'private' : 'public';
}

/** i18n key for a visibility, after legacy mapping. */
export function threadVisibilityLabelKey(value: string | null | undefined): 'threadAccess.private' | 'threadAccess.public' {
  return normalizeThreadVisibility(value) === 'private' ? 'threadAccess.private' : 'threadAccess.public';
}

/** The owner of a thread: `owner_email`, else the wave-1 director (the
 * migration backfills owner from director, so this mirrors the server). */
export function threadOwnerEmail(
  session: { ownerEmail?: string | null; directorEmail?: string | null } | null | undefined,
): string | null {
  const owner = (session?.ownerEmail || session?.directorEmail || '').trim().toLowerCase();
  return owner || null;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

function isAdminOrAbove(me: Pick<WorkspaceMe, 'effectiveRole'> | null | undefined): boolean {
  return !!me?.effectiveRole && ROLE_RANK[me.effectiveRole] >= ROLE_RANK.admin;
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a || '').trim().toLowerCase();
  return !!x && x === (b || '').trim().toLowerCase();
}

/** Owner or admin: may flip visibility, the participants-can-invite switch
 * and hand the thread over. Mirrors the server rule so controls that would
 * 403 stay hidden. */
export function canManageThread(
  me: Pick<WorkspaceMe, 'email' | 'effectiveRole'> | null | undefined,
  ownerEmail: string | null | undefined,
): boolean {
  if (!me) return false;
  if (isAdminOrAbove(me)) return true;
  return sameEmail(me.email, ownerEmail);
}

/** Who may add people to a thread: the owner / an admin always, a participant
 * when the owner switched "participants can add people" on. */
export function canInviteToThread(
  me: Pick<WorkspaceMe, 'email' | 'effectiveRole'> | null | undefined,
  thread: { ownerEmail?: string | null; participantsCanInvite?: boolean } | null | undefined,
  isParticipant: boolean,
): boolean {
  if (canManageThread(me, thread?.ownerEmail)) return true;
  return !!thread?.participantsCanInvite && isParticipant;
}

/** Whether the viewer is on the thread's human ACL. */
export function isThreadParticipant(
  humans: { email: string }[] | null | undefined,
  email: string | null | undefined,
): boolean {
  if (!humans || !email) return false;
  return humans.some((h) => sameEmail(h.email, email));
}

/** A public thread the viewer has not joined shows the Join button. */
export function showJoinButton(
  visibility: string | null | undefined,
  humans: { email: string }[] | null | undefined,
  email: string | null | undefined,
): boolean {
  if (!email || humans == null) return false;
  return normalizeThreadVisibility(visibility) === 'public' && !isThreadParticipant(humans, email);
}

// ── Grantees ─────────────────────────────────────────────────────────────────

/** Stable identity for de-duplication: `kind:id` (ids are lower-cased emails,
 * agent names or group ids, so the same principal never appears twice). */
export function granteeKey(g: Pick<Grantee, 'kind' | 'id'>): string {
  return `${g.kind}:${g.id}`;
}

/** Chip text: people by display name (or the local part of the email), agents
 * as `@name`, groups by name. Never an empty string. */
export function granteeChipLabel(g: Pick<Grantee, 'kind' | 'id' | 'label'>): string {
  const label = (g.label || '').trim();
  switch (g.kind) {
    case 'human':
      return label || displayNameFromEmail(g.id) || g.id;
    case 'agent':
      return `@${label || g.id}`;
    default:
      return label || g.id;
  }
}

/** Merge new picks into a selection without duplicates, keeping order. */
export function mergeGrantees(current: Grantee[], additions: Grantee[]): Grantee[] {
  const seen = new Set(current.map(granteeKey));
  const out = [...current];
  for (const g of additions) {
    const key = granteeKey(g);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

export function removeGrantee(current: Grantee[], target: Pick<Grantee, 'kind' | 'id'>): Grantee[] {
  const key = granteeKey(target);
  return current.filter((g) => granteeKey(g) !== key);
}

/** `exclude` on the picker accepts bare ids or `kind:id` keys. */
export function isExcludedGrantee(g: Pick<Grantee, 'kind' | 'id'>, exclude: string[] | null | undefined): boolean {
  if (!exclude || exclude.length === 0) return false;
  const id = g.id.toLowerCase();
  const key = granteeKey(g).toLowerCase();
  return exclude.some((e) => {
    const x = e.toLowerCase();
    return x === id || x === key;
  });
}

export function granteeFromGroup(group: Pick<SecurityGroup, 'id' | 'name'>): Grantee {
  return { kind: 'group', id: group.id, label: group.name };
}

export function granteeFromMember(member: Pick<GroupMember, 'principal_kind' | 'principal_id' | 'display_name'>): Grantee {
  return {
    kind: member.principal_kind,
    id: member.principal_id,
    label: member.display_name || (member.principal_kind === 'human' ? displayNameFromEmail(member.principal_id) : member.principal_id),
  };
}

export function granteeFromGrant(grant: Pick<ResourceGrant, 'grantee_kind' | 'grantee_id' | 'grantee_label'>): Grantee {
  return { kind: grant.grantee_kind, id: grant.grantee_id, label: grant.grantee_label || grant.grantee_id };
}

/** Only these kinds may be *members* of a group (groups don't nest). */
export const GROUP_MEMBER_KINDS: GranteeKind[] = ['human', 'agent'];

/** A grant with an `expires_at` in the past is shown struck through rather
 * than hidden — the server lists it until it is revoked or purged. */
export function isGrantExpired(grant: Pick<ResourceGrant, 'expires_at'>, now: number = Date.now()): boolean {
  if (!grant.expires_at) return false;
  const ts = new Date(grant.expires_at).getTime();
  return Number.isFinite(ts) && ts <= now;
}

/** `<input type="date">` value (local day) → ISO at end of that day, UTC. An
 * empty value means "no expiry". */
export function expiryDateToIso(day: string | null | undefined): string | undefined {
  if (!day) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return undefined;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : undefined;
}

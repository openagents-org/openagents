/**
 * Owner-side logic for OpenAgents Jam guest links (`/v1/guest-links`):
 * which link is live, the expiry choices, and when the panel applies.
 * Kept free of React so it can be unit tested.
 */

export interface GuestLink {
  id: string;
  channel: string;
  /** `<app>/jam/<token>` */
  url: string;
  canPost: boolean;
  /** `owner`: a guest's request to the agent waits for the owner's approval. */
  approvalMode?: ApprovalMode;
  /** Who can open it: anyone with the link, or only invited (signed-in) people. */
  access?: LinkAccess;
  /** Invite-only: the invited emails (owner's view). */
  invitedEmails?: string[];
  /** Guests may bring their own agents into the jam. */
  allowGuestAgents?: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
}

/** How guests may use the agent: right away, after the owner approves, or not at all. */
export type ApprovalMode = 'none' | 'owner' | 'off';
export type LinkAccess = 'link' | 'invited';

/** A guest of the thread, as the owner sees them. */
export interface ThreadGuestRecord {
  id: string;
  name: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
  /** Removed by the owner: can still read, can no longer post. */
  removed: boolean;
}

/** Where the owner's link calls go: the workspace API (signed-in owner) or
 * the owner page (workspace token from the owner link). */
export interface GuestLinksClient {
  list(channel: string): Promise<GuestLink[]>;
  create(channel: string, expiresAt: string | null): Promise<GuestLink>;
  updateExpiry(id: string, expiresAt: string | null): Promise<GuestLink>;
  revoke(id: string): Promise<GuestLink>;
  /** Whether guests' requests to the agent wait for the owner (absent: not offered). */
  updateApprovalMode?(id: string, mode: ApprovalMode): Promise<GuestLink>;
  /** Guests can post (false = a read-only link). */
  updateCanPost?(id: string, canPost: boolean): Promise<GuestLink>;
  listGuests?(channel: string): Promise<ThreadGuestRecord[]>;
  /** Guests may bring their own agents. */
  updateAllowGuestAgents?(id: string, allow: boolean): Promise<GuestLink>;
  /** General access: anyone with the link, or only invited people. */
  updateAccess?(id: string, access: LinkAccess): Promise<GuestLink>;
  /** Invite by email; returns the updated link and who was newly added. */
  addInvites?(id: string, emails: string[]): Promise<{ link: GuestLink; added: string[] }>;
  removeInvite?(id: string, email: string): Promise<GuestLink>;
  removeGuest?(channel: string, guestId: string): Promise<ThreadGuestRecord>;
}

/** Threads made by `POST /v1/share/publish` are named `share-<hex>`. */
export const SHARED_THREAD_PREFIX = 'share-';

export function isSharedThreadName(channel: string | null | undefined): boolean {
  return !!channel && channel.startsWith(SHARED_THREAD_PREFIX);
}

export function isExpired(link: Pick<GuestLink, 'expiresAt'>, now: number = Date.now()): boolean {
  if (!link.expiresAt) return false;
  const at = Date.parse(link.expiresAt);
  return Number.isFinite(at) && at <= now;
}

export function isLive(link: GuestLink, now: number = Date.now()): boolean {
  return !link.revokedAt && !isExpired(link, now);
}

/** The newest live link (the list comes newest first, but don't rely on it). */
export function liveLink(links: GuestLink[], now: number = Date.now()): GuestLink | null {
  const live = links.filter((l) => isLive(l, now));
  if (live.length === 0) return null;
  return [...live].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
}

export type GuestLinkState =
  | { kind: 'live'; link: GuestLink }
  | { kind: 'expired'; link: GuestLink }
  | { kind: 'off'; link: GuestLink }
  | { kind: 'none' };

/** What the panel shows: the live link, else why the newest one stopped. */
export function guestLinkState(links: GuestLink[], now: number = Date.now()): GuestLinkState {
  const live = liveLink(links, now);
  if (live) return { kind: 'live', link: live };
  const newest = [...links].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  if (!newest) return { kind: 'none' };
  return newest.revokedAt ? { kind: 'off', link: newest } : { kind: 'expired', link: newest };
}

/** The panel shows for threads that have guest links, and always for shared threads. */
export function showGuestLinkPanel(channel: string, links: GuestLink[] | null): boolean {
  return isSharedThreadName(channel) || (!!links && links.length > 0);
}

export type ExpiryChoice = 'never' | '1d' | '7d' | '30d';
export const EXPIRY_CHOICES: ExpiryChoice[] = ['never', '1d', '7d', '30d'];
const DAY_MS = 24 * 60 * 60 * 1000;
const CHOICE_DAYS: Record<Exclude<ExpiryChoice, 'never'>, number> = { '1d': 1, '7d': 7, '30d': 30 };

/** `expires_at` for a choice: null = never, else an ISO time from now. */
export function expiryForChoice(choice: ExpiryChoice, now: number = Date.now()): string | null {
  if (choice === 'never') return null;
  return new Date(now + CHOICE_DAYS[choice] * DAY_MS).toISOString();
}

/** Replace one link in the list by id (or add it first, as the newest). */
export function upsertLink(links: GuestLink[], link: GuestLink): GuestLink[] {
  const index = links.findIndex((l) => l.id === link.id);
  if (index < 0) return [link, ...links];
  const next = links.slice();
  next[index] = link;
  return next;
}

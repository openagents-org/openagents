/**
 * Owner-side logic for OpenAgents Share guest links (`/v1/guest-links`):
 * which link is live, the expiry choices, and when the panel applies.
 * Kept free of React so it can be unit tested.
 */

export interface GuestLink {
  id: string;
  channel: string;
  /** `<app>/share/thread/<token>` */
  url: string;
  canPost: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
}

/** Where the owner's link calls go: the workspace API (signed-in owner) or
 * the owner room (workspace token from the owner link). */
export interface GuestLinksClient {
  list(channel: string): Promise<GuestLink[]>;
  create(channel: string, expiresAt: string | null): Promise<GuestLink>;
  updateExpiry(id: string, expiresAt: string | null): Promise<GuestLink>;
  revoke(id: string): Promise<GuestLink>;
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

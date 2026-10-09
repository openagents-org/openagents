/**
 * Direct-message addressing.
 *
 * A DM session id is `dm:` + the two participants' full addresses, sorted and
 * comma-joined — the same (lesser, greater) normalization the backend uses for
 * conversations. A signed-in person's address is `human:<email>` (the backend
 * rewrites the event source to that, so both people in a person↔person DM
 * resolve to the same pair). Anonymous / token-only sessions have no stable
 * identity and keep the legacy shared `human:user` address.
 */

/** The legacy shared human address used before per-person DMs. */
export const LEGACY_HUMAN = 'human:user';

export interface DmIdentity {
  id: string;
  isAuthenticated?: boolean;
}

/** The viewer's own DM address. */
export function myAddress(currentUser: DmIdentity | null | undefined): string {
  const id = (currentUser?.id || '').trim();
  if (currentUser?.isAuthenticated && id.includes('@')) return `human:${id.toLowerCase()}`;
  return LEGACY_HUMAN;
}

/** Canonical DM session id for the viewer and a counterpart address. */
export function dmSessionId(me: string, counterpart: string): string {
  const pair = [me, counterpart].sort();
  return `dm:${pair[0]},${pair[1]}`;
}

/** Split a `dm:a,b` session id into its two addresses ([] if not a DM). */
export function dmPair(sessionId: string | null | undefined): string[] {
  if (!sessionId || !sessionId.startsWith('dm:')) return [];
  return sessionId.slice(3).split(',').filter(Boolean);
}

/** True when an address is the viewer — their own address or legacy `human:user`. */
export function isMyAddress(address: string | null | undefined, me: string): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  return a === me.toLowerCase() || a === LEGACY_HUMAN;
}

/**
 * The other party of a DM the viewer takes part in, or null when the viewer is
 * not in it (agent↔agent observation pairs, other people's DMs).
 *
 * Legacy `human:user` counts as the viewer. A human↔agent pair whose human is
 * some other non-email id (`human:<uuid>` from older clients) is still treated
 * as the viewer's own thread with that agent, matching the old behaviour.
 */
export function dmCounterpart(
  sessionOrPair: string | readonly string[] | null | undefined,
  me: string,
): string | null {
  const pair = typeof sessionOrPair === 'string' || !sessionOrPair ? dmPair(sessionOrPair) : sessionOrPair;
  if (pair.length !== 2) return null;
  const [a, b] = pair;
  const aMe = isMyAddress(a, me);
  const bMe = isMyAddress(b, me);
  if (aMe && !bMe) return b;
  if (bMe && !aMe) return a;
  if (aMe && bMe) return a.toLowerCase() === me.toLowerCase() ? b : a;
  const humans = pair.filter((x) => x.startsWith('human:'));
  if (humans.length === 1) {
    // Another signed-in person's address is never "me".
    if (humans[0].includes('@')) return null;
    return pair.find((x) => !x.startsWith('human:')) ?? null;
  }
  return null;
}

/** Bare name of an address: `openagents:scout` → `scout`, `human:a@b` → `a@b`. */
export function addressName(address: string): string {
  return address.replace(/^openagents:/, '').replace(/^human:/, '');
}

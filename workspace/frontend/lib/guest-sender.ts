/**
 * Shared-thread guests (OpenAgents Share) post as
 * `human:guest-<id>@guest.invalid` with `metadata.guest = {id, name}`. The
 * address is an internal handle: the UI shows the guest's chosen name and a
 * "Guest" badge, never the address.
 */

export const GUEST_EMAIL_DOMAIN = 'guest.invalid';

/** `guest-…@guest.invalid`, with or without the `human:` prefix. */
export function isGuestAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  return address.trim().toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

interface GuestSenderSource {
  senderAddress?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** True when a message was posted by a shared-thread guest. */
export function isGuestMessage(message: GuestSenderSource): boolean {
  const guest = message.metadata?.guest;
  if (guest && typeof guest === 'object') return true;
  return isGuestAddress(message.senderAddress) || isGuestAddress(message.senderId)
    || isGuestAddress(message.metadata?.sender_email as string | undefined);
}

/**
 * The name to show for a guest: `metadata.guest.name`, then the payload's
 * `sender_name` (already in `senderName`), else "Guest". Never the address.
 */
export function guestDisplayName(message: GuestSenderSource, payloadName?: unknown, fallback = 'Guest'): string {
  const guest = message.metadata?.guest as { name?: unknown } | undefined;
  const candidates = [guest?.name, payloadName, message.senderName];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() && !isGuestAddress(value) && !value.toLowerCase().startsWith('human:')) {
      return value.trim();
    }
  }
  return fallback;
}

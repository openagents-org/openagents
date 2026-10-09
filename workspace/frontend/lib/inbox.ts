import type { NotificationItem } from './types';

/**
 * Pure helpers for the inbox — kept framework-free so the grouping can be
 * unit-tested and shared by the inbox view and anything that counts rows.
 *
 * A row is *actionable* when it points at something a person can decide on
 * from the inbox (v1.1: an approval, a `help` question or a `proposal`, all
 * on the approvals table). Everything else is a plain notice.
 */

export type InboxActionKind = 'approval' | 'help' | 'proposal';

export const ACTIONABLE_KINDS: readonly InboxActionKind[] = ['approval', 'help', 'proposal'];

export function inboxActionKind(n: Pick<NotificationItem, 'kind' | 'actionRef'>): InboxActionKind | null {
  if (!n.actionRef) return null;
  return (ACTIONABLE_KINDS as readonly string[]).includes(n.kind ?? '') ? (n.kind as InboxActionKind) : null;
}

export function isActionableNotification(n: Pick<NotificationItem, 'kind' | 'actionRef'>): boolean {
  return inboxActionKind(n) !== null;
}

/**
 * Person-to-person rows (Slack "Activity" style): someone @mentioned you in a
 * thread (`channelName` = the thread) or sent you a direct message
 * (`channelName` = the `dm:` session id). Clicking opens the conversation.
 */
export type InboxMessageKind = 'mention' | 'dm';

export const MESSAGE_KINDS: readonly InboxMessageKind[] = ['mention', 'dm'];

export function inboxMessageKind(n: Pick<NotificationItem, 'kind'>): InboxMessageKind | null {
  return (MESSAGE_KINDS as readonly string[]).includes(n.kind ?? '') ? (n.kind as InboxMessageKind) : null;
}

/**
 * The session a row opens when clicked: a DM row's `dm:` session id always
 * (DMs are not in the thread list), otherwise the thread when it is known.
 */
export function inboxSessionTarget(
  n: Pick<NotificationItem, 'channelName'>,
  hasSession: (sessionId: string) => boolean,
): string | null {
  const channel = n.channelName;
  if (!channel) return null;
  if (channel.startsWith('dm:')) return channel;
  return hasSession(channel) ? channel : null;
}

const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

/** Addressed to me, or to nobody in particular (the whole workspace). */
export function isAddressedToMe(
  n: Pick<NotificationItem, 'recipientEmail'>,
  myEmail: string | null | undefined,
): boolean {
  if (!n.recipientEmail) return true;
  return sameEmail(n.recipientEmail, myEmail);
}

const PRIORITY_ORDER: Record<NotificationItem['priority'], number> = { high: 0, normal: 1, low: 2 };
const ts = (n: NotificationItem) => (n.createdAt ? new Date(n.createdAt).getTime() : 0);

/** High first, then newest first (what the unread list always did). */
export function byPriorityThenNewest(a: NotificationItem, b: NotificationItem): number {
  const p = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
  if (p !== 0) return p;
  return ts(b) - ts(a);
}

/** Unread before read, then newest first. */
export function byUnreadThenNewest(a: NotificationItem, b: NotificationItem): number {
  if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
  return ts(b) - ts(a);
}

/** An unread mention / DM row addressed to me by name (never a broadcast). */
export function isUnreadMessageForMe(
  n: Pick<NotificationItem, 'kind' | 'isRead' | 'recipientEmail'>,
  myEmail: string | null | undefined,
): boolean {
  return inboxMessageKind(n) !== null && !n.isRead && sameEmail(n.recipientEmail, myEmail);
}

export interface InboxGroups {
  /** Unresolved actionable rows addressed to me (or to nobody), plus unread
   * mentions / DMs addressed to me. */
  needsYou: NotificationItem[];
  /** Everything else: notices, other people's requests, resolved requests. */
  updates: NotificationItem[];
}

/**
 * Split the inbox into "Needs you" and "Updates".
 *
 * `resolvedRefs` are action refs known to be decided already (the caller
 * learns this from the live approval records / the pending list); a resolved
 * request is an update, not a to-do, whoever it was addressed to. Rows are
 * never dropped: dismissed ones are the caller's job to filter.
 */
export function groupInboxRows(
  notifications: readonly NotificationItem[],
  myEmail: string | null | undefined,
  resolvedRefs?: ReadonlySet<string> | null,
): InboxGroups {
  const needsYou: NotificationItem[] = [];
  const updates: NotificationItem[] = [];
  for (const n of notifications) {
    const actionable = isActionableNotification(n);
    const resolved = Boolean(n.actionRef && resolvedRefs?.has(n.actionRef));
    if (actionable && !resolved && isAddressedToMe(n, myEmail)) needsYou.push(n);
    else if (isUnreadMessageForMe(n, myEmail)) needsYou.push(n);
    else updates.push(n);
  }
  needsYou.sort(byPriorityThenNewest);
  updates.sort(byUnreadThenNewest);
  return { needsYou, updates };
}

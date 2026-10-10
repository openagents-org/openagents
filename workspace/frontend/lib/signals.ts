import type { NotificationItem } from './types';

/**
 * Slack-style signals: DMs and @mentions.
 *
 * They are stored server-side as notification rows (`kind: 'dm' | 'mention'`,
 * `channelName` = the thread name or the `dm:` session id) but never shown in
 * the inbox. Instead they highlight the thread / DM as unread and raise a
 * desktop notification. Everything here is pure so it can be unit-tested.
 */

export type SignalKind = 'dm' | 'mention';

export const SIGNAL_KINDS: readonly SignalKind[] = ['dm', 'mention'];

export interface ChannelSignals {
  mentions: number;
  dms: number;
  /** The newest signal for the channel. */
  latest: NotificationItem;
}

export type UnreadSignals = Record<string, ChannelSignals>;

export function signalKind(n: Pick<NotificationItem, 'kind'>): SignalKind | null {
  return (SIGNAL_KINDS as readonly string[]).includes(n.kind ?? '') ? (n.kind as SignalKind) : null;
}

const ts = (n: NotificationItem) => (n.createdAt ? new Date(n.createdAt).getTime() : 0);

/** Unread DM / mention rows grouped by the channel they point at. */
export function groupSignals(signals: readonly NotificationItem[]): UnreadSignals {
  const out: UnreadSignals = {};
  for (const n of signals) {
    const kind = signalKind(n);
    const channel = n.channelName;
    if (!kind || !channel || n.isRead) continue;
    const entry = out[channel] ?? { mentions: 0, dms: 0, latest: n };
    if (kind === 'mention') entry.mentions += 1;
    else entry.dms += 1;
    if (ts(n) >= ts(entry.latest)) entry.latest = n;
    out[channel] = entry;
  }
  return out;
}

/** Drop rows the user already read locally (a poll may race the PATCH). */
export function withoutLocallyRead(
  signals: readonly NotificationItem[],
  readIds: ReadonlySet<string>,
): NotificationItem[] {
  return signals.filter((n) => !readIds.has(n.id));
}

/**
 * Which signals are new since the last poll.
 *
 * `seen` is null before the first poll: that load only baselines what was
 * already there (nothing is "new" on page open). Returns the new rows and the
 * updated seen-set; never mutates its input.
 */
export function diffNewSignals(
  seen: ReadonlySet<string> | null,
  signals: readonly NotificationItem[],
): { fresh: NotificationItem[]; seen: Set<string> } {
  const next = new Set(seen ?? []);
  const fresh: NotificationItem[] = [];
  for (const n of signals) {
    if (next.has(n.id)) continue;
    next.add(n.id);
    if (seen) fresh.push(n);
  }
  return { fresh, seen: next };
}

export interface NotifyContext {
  /** document.visibilityState === 'hidden' */
  hidden: boolean;
  /** document.hasFocus() */
  focused: boolean;
  /** The thread / DM currently open, if any. */
  openSessionId: string | null;
}

/**
 * Notify unless the user is already looking at the conversation: the window is
 * visible and focused AND the signal's channel is the open one.
 */
export function shouldNotify(signal: Pick<NotificationItem, 'channelName'>, ctx: NotifyContext): boolean {
  if (ctx.hidden || !ctx.focused) return true;
  return !signal.channelName || signal.channelName !== ctx.openSessionId;
}

/** localStorage key remembering the desktop-notification prompt was dismissed. */
export const NOTIFICATION_PROMPT_DISMISSED_KEY = 'oa_desktop_notifications_prompt_dismissed';

/**
 * Show the "turn on desktop notifications" prompt? Only where the browser
 * supports it, the user hasn't decided yet nor dismissed the prompt, and they
 * have a reason to care (a DM / mention arrived, or they opened a DM).
 */
export function shouldShowNotificationPrompt(opts: {
  supported: boolean;
  permission: string | null;
  dismissed: boolean;
  triggered: boolean;
}): boolean {
  return opts.supported && opts.permission === 'default' && !opts.dismissed && opts.triggered;
}

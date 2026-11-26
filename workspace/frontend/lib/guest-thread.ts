/**
 * Pure logic for the guest view of a shared thread (`/jam/<token>`):
 * event → message mapping and sender identity, poll merging, the "Ask agent"
 * prefix, and idempotent sends. Kept free of React so it can be unit tested.
 */
import { eventToMessage, type ONMEvent, type WorkspaceAgent, type WorkspaceMessage } from '@/lib/types';
import { mergeMessages } from '@/lib/message-merge';
import { GUEST_EMAIL_DOMAIN } from '@/lib/guest-sender';
import type { GuestIdentity, GuestThreadAgent } from '@/lib/guest-thread-api';

export const GUEST_NAME_MAX = 40;
export const OPTIMISTIC_PREFIX = 'optimistic-';

// ── Agents ──

/** Shape the public agent list like workspace agents so shared helpers
 * (agentLabel, AgentAvatar, IntermediateSteps) render them the same way. */
export function toWorkspaceAgents(agents: GuestThreadAgent[]): WorkspaceAgent[] {
  return agents.map((agent) => ({
    agentName: agent.name,
    // Agents go by their handle on the share pages (`pr-reviewer`), everywhere.
    displayName: agent.name,
    role: 'member',
    agentType: agent.type || null,
    serverHost: null,
    workingDir: null,
    description: null,
    enabledSkills: null,
    model: null,
    status: agent.online ? 'online' : 'offline',
    lastHeartbeatAt: null,
    joinedAt: null,
  }));
}

/** An agent's name on the share pages: its handle (`pr-reviewer`), the same in every surface. */
export function agentDisplayName(agent: Pick<GuestThreadAgent, 'name' | 'displayName'>): string {
  return agent.name || agent.displayName?.trim() || '';
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  'claude-code': 'Claude Code',
  claude_code: 'Claude Code',
  claudecode: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  'gemini-cli': 'Gemini CLI',
  openclaw: 'OpenClaw',
};

/** "claude-code" → "Claude Code"; unknown types are title-cased. */
export function agentTypeLabel(type: string | null | undefined): string | null {
  const key = (type || '').trim().toLowerCase();
  if (!key) return null;
  if (AGENT_TYPE_LABELS[key]) return AGENT_TYPE_LABELS[key];
  return key.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ── Event → message ──

/**
 * Map a public thread event to a chat message, reusing the workspace
 * transform. Guest posts may come from a non-`human:` address, so a
 * `metadata.guest` record always marks the sender as a person.
 */
export function guestEventToMessage(event: ONMEvent): WorkspaceMessage {
  const message = eventToMessage({ ...event, metadata: event.metadata || {}, target: event.target || '' });
  const payload = (event.payload || {}) as Record<string, unknown>;
  const guest = guestOf(message);
  const source = event.source || '';
  if (guest) {
    return { ...message, senderType: 'human', senderName: guest.name || (payload.sender_name as string) || 'Guest' };
  }
  if (source.startsWith('openagents:')) {
    // Agents are looked up by name; the label comes from the agent list.
    return { ...message, senderType: 'agent', senderName: source.slice('openagents:'.length) };
  }
  if (source.startsWith('human:') && !payload.sender_name) {
    const address = source.slice('human:'.length);
    return { ...message, senderName: address.includes('@') ? address.split('@')[0] : address };
  }
  return message;
}

export function guestOf(message: Pick<WorkspaceMessage, 'metadata'>): GuestIdentity | null {
  const guest = message.metadata?.guest as Partial<GuestIdentity> | undefined;
  if (!guest || typeof guest !== 'object' || typeof guest.id !== 'string') return null;
  return { id: guest.id, name: typeof guest.name === 'string' ? guest.name : '' };
}

export function isSeedMessage(message: Pick<WorkspaceMessage, 'metadata'>): boolean {
  return message.metadata?.share_seed === true;
}

/** The share's owner posting from the owner page (`human:owner`, `metadata.share_owner`). */
export function isOwnerMessage(message: Pick<WorkspaceMessage, 'metadata' | 'senderAddress'>): boolean {
  return message.metadata?.share_owner === true || message.senderAddress === 'human:owner';
}

export type SenderKind = 'agent' | 'guest' | 'human';

export interface SenderIdentity {
  kind: SenderKind;
  /** Name to show; the caller swaps in "You" when `isSelf`. */
  name: string;
  isSelf: boolean;
  agent?: WorkspaceAgent;
  /** Stable seed for the avatar colour. */
  avatarSeed: string;
}

/** Who is looking: a guest (maybe named) or the share's owner. */
export interface ThreadViewer {
  guestId: string | null;
  isOwner?: boolean;
  /** Owner's display name, for owner-jam posts that carry no sender name. */
  ownerName?: string;
}

function toViewer(viewer: string | null | ThreadViewer): ThreadViewer {
  return viewer && typeof viewer === 'object' ? viewer : { guestId: viewer };
}

export function senderIdentity(message: WorkspaceMessage, agents: WorkspaceAgent[], viewerOrGuestId: string | null | ThreadViewer): SenderIdentity {
  const viewer = toViewer(viewerOrGuestId);
  const currentGuestId = viewer.guestId;
  const guest = guestOf(message);
  if (guest) {
    return {
      kind: 'guest',
      name: guest.name || message.senderName || 'Guest',
      isSelf: !!currentGuestId && guest.id === currentGuestId,
      avatarSeed: guestAvatarSeed(guest.id),
    };
  }
  if (message.senderType === 'agent') {
    const agent = agents.find((a) => a.agentName === message.senderName);
    return {
      kind: 'agent',
      name: agent?.agentName || message.senderName,
      isSelf: false,
      agent,
      avatarSeed: message.senderName,
    };
  }
  if (isOwnerMessage(message)) {
    const named = message.senderName && message.senderName !== 'owner' && message.senderName !== 'user' ? message.senderName : '';
    const name = viewer.ownerName || named || 'Owner';
    return { kind: 'human', name, isSelf: !!viewer.isOwner, avatarSeed: humanSeed(name) };
  }
  const name = message.senderName && message.senderName !== 'user' ? message.senderName : 'User';
  return { kind: 'human', name, isSelf: false, avatarSeed: humanSeed(name) };
}

/** Seed excerpts first (in their own order), then the live conversation. */
export function splitSeed(messages: WorkspaceMessage[]): { seed: WorkspaceMessage[]; rest: WorkspaceMessage[] } {
  const seed: WorkspaceMessage[] = [];
  const rest: WorkspaceMessage[] = [];
  for (const m of messages) (isSeedMessage(m) ? seed : rest).push(m);
  return { seed, rest };
}

// ── Poll merge ──

/** Newest real (server) id in an ascending page — the next `after` cursor. */
export function nextCursor(current: string | null, page: ONMEvent[]): string | null {
  return page.length > 0 ? page[page.length - 1].id : current;
}

/**
 * Merge a page of polled events into the list. Deduped by id; an optimistic
 * message whose send key matches an arrived event's `metadata.client_key`
 * (the server's echo of the idempotency key) is replaced by it, so a send
 * that the poll sees before the POST resolves shows once.
 */
export function mergeEvents(prev: WorkspaceMessage[], events: ONMEvent[]): WorkspaceMessage[] {
  if (events.length === 0) return prev;
  const incoming = events.map(guestEventToMessage);
  const arrivedKeys = new Set(incoming.map(idempotencyKeyOf).filter(Boolean));
  const kept = arrivedKeys.size ? prev.filter((m) => !(isOptimistic(m) && arrivedKeys.has(idempotencyKeyOf(m)))) : prev;
  return mergeMessages(kept, incoming);
}

export function isOptimistic(message: Pick<WorkspaceMessage, 'messageId'>): boolean {
  return message.messageId.startsWith(OPTIMISTIC_PREFIX);
}

/** The send key: `client_key` as echoed by the server, or our own copy on an optimistic row. */
export function idempotencyKeyOf(message: Pick<WorkspaceMessage, 'metadata'>): string {
  const key = message.metadata?.client_key ?? message.metadata?.idempotency_key;
  return typeof key === 'string' ? key : '';
}

/** Has the server already stored the send with this key (seen by a poll)? */
export function isDelivered(messages: WorkspaceMessage[], key: string): boolean {
  return !!key && messages.some((m) => !isOptimistic(m) && idempotencyKeyOf(m) === key);
}

/** Swap the optimistic copy of a send for the stored event. */
export function reconcileSent(prev: WorkspaceMessage[], optimisticId: string, event: ONMEvent): WorkspaceMessage[] {
  const without = prev.filter((m) => m.messageId !== optimisticId);
  return mergeMessages(without, [guestEventToMessage(event)]);
}

/**
 * Mark a send as failed — unless a poll already brought the stored message
 * (the POST failed after the server kept it), which then stays as the only copy.
 */
export function markSendFailed(prev: WorkspaceMessage[], failed: WorkspaceMessage): WorkspaceMessage[] {
  const key = idempotencyKeyOf(failed);
  if (isDelivered(prev, key)) return removeMessage(prev, failed.messageId);
  return upsertMessage(prev, failed);
}

// ── Earlier messages ──

/** Oldest server id in an ascending page — the next `before` cursor. */
export function olderCursor(current: string | null, page: ONMEvent[]): string | null {
  return page.length > 0 ? page[0].id : current;
}

// ── Composer ──

/** One agent in the thread → asking it is the obvious default. */
export function defaultAskAgent(agents: GuestThreadAgent[]): boolean {
  return agents.length === 1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function startsWithMention(text: string, agentName: string): boolean {
  return new RegExp(`^@${escapeRegExp(agentName)}(?:\\s|$)`).test(text.trimStart());
}

/**
 * Does the text address this agent anywhere (`… @agent …`)? The server routes
 * any such mention to the agent (not only a leading one); an email-like
 * `me@agent` doesn't count.
 */
export function mentionsAgent(text: string, agentName: string): boolean {
  return new RegExp(`(?<![\\w@.])@${escapeRegExp(agentName)}(?![\\w-])`).test(text);
}

/**
 * What actually gets posted. The thread is passive: only a message that starts
 * with `@<agent> ` runs the agent; anything else is a comment. With "Ask" on
 * the prefix is added (never doubled); with it off the text goes as typed.
 */
export function composeOutgoing(text: string, askAgent: boolean, agentName: string | null): string {
  const body = text.trim();
  if (!body) return '';
  if (!askAgent || !agentName) return body;
  if (startsWithMention(body, agentName)) return body;
  return `@${agentName} ${body}`;
}

/** Will this send run an agent? (Ask on, or the guest typed the mention.) */
export function willRunAgent(text: string, askAgent: boolean, agentName: string | null, agents: GuestThreadAgent[]): boolean {
  if (askAgent && agentName) return true;
  return agents.some((a) => mentionsAgent(text, a.name));
}

/** Trimmed display name, or null when empty or longer than 40 characters. */
export function normalizeGuestName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < 1 || length > GUEST_NAME_MAX) return null;
  return name;
}

// ── Sending ──

export interface PendingSend {
  localId: string;
  /** Generated once per send; reused by every retry of that send. */
  idempotencyKey: string;
  content: string;
}

export function newPendingSend(content: string, makeId: () => string = randomId): PendingSend {
  return { localId: `${OPTIMISTIC_PREFIX}${makeId()}`, idempotencyKey: makeId(), content };
}

export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // The server wants 16–128 characters for an idempotency key.
  const part = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${Date.now().toString(36)}-${part()}-${part()}-${part()}`;
}

/** Send (or resend) a pending message; the same key goes out every time. */
export function sendPending(
  pending: PendingSend,
  post: (content: string, idempotencyKey: string) => Promise<ONMEvent>,
): Promise<ONMEvent> {
  return post(pending.content, pending.idempotencyKey);
}

export function optimisticMessage(pending: PendingSend, guest: GuestIdentity, status: 'sending' | 'failed' = 'sending', error?: string): WorkspaceMessage {
  return {
    messageId: pending.localId,
    sessionId: '',
    senderId: null,
    senderAddress: null,
    senderType: 'human',
    senderName: guest.name,
    content: pending.content,
    mentions: [],
    targetAgents: null,
    messageType: 'chat',
    metadata: { guest, idempotency_key: pending.idempotencyKey, send_status: status, ...(error ? { send_error: error } : {}) },
    createdAt: new Date().toISOString(),
  };
}

/** Optimistic row for a send from the owner page. */
export function optimisticOwnerMessage(pending: PendingSend, ownerName: string, status: 'sending' | 'failed' = 'sending', error?: string): WorkspaceMessage {
  return {
    messageId: pending.localId,
    sessionId: '',
    senderId: null,
    senderAddress: 'human:owner',
    senderType: 'human',
    senderName: ownerName,
    content: pending.content,
    mentions: [],
    targetAgents: null,
    messageType: 'chat',
    metadata: { share_owner: true, idempotency_key: pending.idempotencyKey, send_status: status, ...(error ? { send_error: error } : {}) },
    createdAt: new Date().toISOString(),
  };
}

// ── Polling cadence ──

export const POLL_VISIBLE_MS = 3000;
export const POLL_HIDDEN_MS = 15000;
export const POLL_MAX_MS = 30000;

/** ~3s while visible, slower when hidden, doubling on consecutive errors. */
export function nextPollDelay(hidden: boolean, failures: number): number {
  const base = hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
  return Math.min(POLL_MAX_MS, base * 2 ** Math.min(failures, 4));
}

/** Insert or replace one message by id (used for optimistic sends). */
export function upsertMessage(prev: WorkspaceMessage[], message: WorkspaceMessage): WorkspaceMessage[] {
  return mergeMessages(prev.filter((m) => m.messageId !== message.messageId), [message]);
}

export function removeMessage(prev: WorkspaceMessage[], messageId: string): WorkspaceMessage[] {
  const next = prev.filter((m) => m.messageId !== messageId);
  return next.length === prev.length ? prev : next;
}

// ── People ──

/** Avatar colour seed for a workspace member, keyed by name so the sidebar
 * and their messages agree (the guest API exposes names, not emails). */
export function humanSeed(name: string): string {
  return `name:${name.trim().toLowerCase()}`;
}

/** A guest's avatar seed: their posting address, as the workspace seeds it,
 * so a guest has the same colour here and in the owner's workspace. */
export function guestAvatarSeed(guestId: string): string {
  return `guest-${guestId}@${GUEST_EMAIL_DOMAIN}`;
}

export interface ThreadPerson {
  key: string;
  name: string;
  role: 'owner' | 'member' | 'guest';
  isSelf: boolean;
  avatarSeed: string;
}

/**
 * Who is in the thread, as far as a guest can tell: the owner, people who
 * have posted, and guests who have posted (plus the viewer once named).
 */
export function threadPeople(messages: WorkspaceMessage[], ownerName: string, currentGuest: GuestIdentity | null, viewerIsOwner = false): ThreadPerson[] {
  const people = new Map<string, ThreadPerson>();
  const ownerKey = `name:${ownerName.trim().toLowerCase()}`;
  people.set(ownerKey, { key: ownerKey, name: ownerName, role: 'owner', isSelf: viewerIsOwner, avatarSeed: humanSeed(ownerName) });
  for (const m of messages) {
    if (isOptimistic(m) || isOwnerMessage(m)) continue;
    const guest = guestOf(m);
    if (guest) {
      const key = `guest:${guest.id}`;
      if (!people.has(key)) people.set(key, { key, name: guest.name || m.senderName, role: 'guest', isSelf: guest.id === currentGuest?.id, avatarSeed: guestAvatarSeed(guest.id) });
    } else if (m.senderType === 'human') {
      const key = `name:${m.senderName.trim().toLowerCase()}`;
      if (!people.has(key)) people.set(key, { key, name: m.senderName, role: 'member', isSelf: false, avatarSeed: humanSeed(m.senderName) });
    }
  }
  if (currentGuest && !people.has(`guest:${currentGuest.id}`)) {
    const key = `guest:${currentGuest.id}`;
    people.set(key, { key, name: currentGuest.name, role: 'guest', isSelf: true, avatarSeed: guestAvatarSeed(currentGuest.id) });
  }
  return [...people.values()];
}

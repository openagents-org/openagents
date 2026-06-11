export function uid(): string {
  return (Date.now() + Math.floor(Math.random() * 1000)).toString();
}

export function getInitials(
  name: string | null | undefined,
  count?: number,
): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase());

  return count && count > 0
    ? initials.slice(0, count).join('')
    : initials.join('');
}

export function timeAgo(date: Date | string): string {
  const now = new Date();
  const inputDate = typeof date === 'string' ? new Date(date) : date;
  const diff = Math.floor((now.getTime() - inputDate.getTime()) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600)
    return `${Math.floor(diff / 60)} minute${Math.floor(diff / 60) > 1 ? 's' : ''} ago`;
  if (diff < 86400)
    return `${Math.floor(diff / 3600)} hour${Math.floor(diff / 3600) > 1 ? 's' : ''} ago`;
  if (diff < 604800)
    return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) > 1 ? 's' : ''} ago`;
  if (diff < 2592000)
    return `${Math.floor(diff / 604800)} week${Math.floor(diff / 604800) > 1 ? 's' : ''} ago`;
  if (diff < 31536000)
    return `${Math.floor(diff / 2592000)} month${Math.floor(diff / 2592000) > 1 ? 's' : ''} ago`;

  return `${Math.floor(diff / 31536000)} year${Math.floor(diff / 31536000) > 1 ? 's' : ''} ago`;
}

export function formatDate(input: Date | string | number): string {
  const date = new Date(input);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Agent freshness ──

/** Threshold in ms — offline agents older than this are hidden from sidebar. */
const STALE_AGENT_THRESHOLD = 60 * 60 * 1000; // 1 hour

/** Returns true if agent should be visible in sidebar (online or recently seen). */
export function isRecentAgent(agent: { status: string; lastHeartbeatAt: string | null }): boolean {
  if (agent.status === 'online') return true;
  if (!agent.lastHeartbeatAt) return false;
  const elapsed = Date.now() - new Date(agent.lastHeartbeatAt).getTime();
  return elapsed < STALE_AGENT_THRESHOLD;
}

/**
 * Tri-state agent presence used to pick empty-state / picker copy.
 *   'none'    → no agent has joined this workspace → show "connect an agent"
 *   'offline' → agents are members but none are online → show "agents offline"
 *   'online'  → at least one agent is online → normal flow
 *
 * "Connected" means workspace membership — the agent is in `/v1/discover`'s
 * agent list — independent of online status. A member whose heartbeat has
 * gone stale is still connected; it just isn't online. Only an *empty*
 * membership list should surface the "connect an agent" onboarding, so the
 * gate is membership existence (`agents.length`), deliberately broader than
 * `isRecentAgent`'s 1-hour window (a long-idle member is still connected).
 */
export function agentPresence(
  agents: { status: string }[],
): 'none' | 'offline' | 'online' {
  if (agents.length === 0) return 'none';
  if (agents.some((a) => a.status === 'online')) return 'online';
  return 'offline';
}

// ── Multi-agent visual differentiation ──

const AGENT_COLORS = [
  { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-300', initials: 'bg-blue-500', border: 'border-blue-200 dark:border-blue-800' },
  { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-300', initials: 'bg-purple-500', border: 'border-purple-200 dark:border-purple-800' },
  { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', initials: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-800' },
  { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-300', initials: 'bg-amber-500', border: 'border-amber-200 dark:border-amber-800' },
  { bg: 'bg-rose-50 dark:bg-rose-950/30', text: 'text-rose-700 dark:text-rose-300', initials: 'bg-rose-500', border: 'border-rose-200 dark:border-rose-800' },
];

export type AgentColor = typeof AGENT_COLORS[0];

export function getAgentColor(agentName: string, allAgentNames: string[]): AgentColor {
  const index = allAgentNames.indexOf(agentName);
  return AGENT_COLORS[(index >= 0 ? index : 0) % AGENT_COLORS.length];
}

// ── Routine channel detection ──
//
// Routine channels are per-agent job queues: `routines:<agent-name>`.
// One channel per agent per workspace — every routine the agent owns
// fires into it. These belong in the Inbox tab and must be excluded
// from the Chats list.

export const ROUTINE_CHANNEL_PREFIX = 'routines:';

export function isRoutineChannel(sessionId: string | null | undefined): boolean {
  return !!sessionId && sessionId.startsWith(ROUTINE_CHANNEL_PREFIX);
}

export function routineAgentName(sessionId: string): string | null {
  if (!sessionId.startsWith(ROUTINE_CHANNEL_PREFIX)) return null;
  return sessionId.slice(ROUTINE_CHANNEL_PREFIX.length) || null;
}

import { addressName, dmCounterpart } from './dm';
import type { DMConversation, OnlineUser, TeamMember } from './types';

export type SidebarMember = { email: string; name: string; online: boolean; hasHistory: boolean; lastMessageAt: number; unread: number };

/**
 * Rows the sidebar's member group shows, yourself included; the rest sit behind
 * "N more". People with unread DMs are shown on top of the limit, never cut.
 */
export const SIDEBAR_MEMBER_LIMIT = 5;

/** Resolve presence once, consistently for member and DM lists. */
export function onlineMemberNames(team: TeamMember[], onlineUsers: OnlineUser[]): Map<string, string> {
  const online = new Map<string, string>();
  for (const user of onlineUsers) {
    const id = user.id.replace(/^human:/, '').toLowerCase();
    // Older presence events carry a device id; resolve an unambiguous roster name.
    const matches = team.filter(person => person.displayName?.trim().toLowerCase() === user.name.trim().toLowerCase());
    const email = id.includes('@') ? id : matches.length === 1 ? matches[0].email.toLowerCase() : null;
    if (email) online.set(email, user.name);
  }
  return online;
}

export function sidebarMembers(team: TeamMember[], onlineUsers: OnlineUser[], conversations: DMConversation[], me: string, ownName?: string, unreadOf: (email: string) => number = () => 0): SidebarMember[] {
  const ownEmail = addressName(me).toLowerCase();
  const roster = new Map(team.map(person => [person.email.toLowerCase(), person]));
  const online = onlineMemberNames(team, onlineUsers);
  const history = new Map<string, number>();
  for (const conversation of conversations) {
    const counterpart = dmCounterpart(conversation.agents, me);
    if (!counterpart?.startsWith('human:') || !conversation.messageCount) continue;
    const email = addressName(counterpart).toLowerCase();
    if (!email.includes('@') || email === ownEmail) continue;
    history.set(email, Math.max(history.get(email) || 0, conversation.lastMessage.timestamp));
  }
  const row = (email: string): SidebarMember => ({
    email, name: roster.get(email)?.displayName || online.get(email) || email,
    online: online.has(email), hasHistory: history.has(email), lastMessageAt: history.get(email) || 0, unread: unreadOf(email),
  });
  // The roster carries the profile name, so it wins over a sign-in name that may
  // be no more than the email the session started with.
  const self: SidebarMember[] = ownEmail.includes('@') ? [{ email: ownEmail, name: roster.get(ownEmail)?.displayName || ownName || ownEmail, online: true, hasHistory: true, lastMessageAt: 0, unread: unreadOf(ownEmail) }] : [];
  // People you have talked to, plus whoever is online now. Unread DMs come
  // first, then online people, then the most recent conversation, then the
  // name. The list stops at the limit, yourself counted, but a row with unread
  // messages is never cut: "N more" and the member dialog carry no badge, so a
  // hidden row would hide the message with it.
  const others = Array.from(new Set([...history.keys(), ...online.keys()]), row)
    .filter(person => person.email !== ownEmail)
    .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || Number(b.online) - Number(a.online) || b.lastMessageAt - a.lastMessageAt || a.name.localeCompare(b.name));
  const unreadRows = others.filter(person => person.unread > 0).length;
  return [...self, ...others].slice(0, Math.max(SIDEBAR_MEMBER_LIMIT, self.length + unreadRows));
}

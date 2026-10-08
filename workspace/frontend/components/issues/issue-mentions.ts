import type {
  IssueDetail,
  OnlineUser,
  TeamMember,
  WorkspaceAgent,
  WorkspaceIssue,
} from '@/lib/types';
import { agentLabel } from '@/lib/helpers';

export interface IssueMention {
  source: string;
  name: string;
  token: string;
  kind: 'human' | 'agent';
}

export function issueMention(source: string, name: string): IssueMention {
  const kind = source.startsWith('openagents:') ? 'agent' : 'human';
  const id = source.replace(/^(human:|openagents:)/, '');
  // Email identities are readable and unambiguous. Guests need a namespace
  // so a human and an agent can never accidentally share the same handle.
  const token = kind === 'agent' || id.includes('@') ? id : `human:${id}`;
  return { source, name, token, kind };
}

export function issueMentionOptions({
  team = [],
  agents = [],
  onlineUsers = [],
  currentUser,
  issue,
}: {
  team?: TeamMember[];
  agents?: WorkspaceAgent[];
  onlineUsers?: OnlineUser[];
  currentUser: { id: string; name: string };
  issue?:
    | (WorkspaceIssue & Partial<Pick<IssueDetail, 'comments' | 'threads'>>)
    | null;
}): IssueMention[] {
  const people = new Map<string, IssueMention>();
  const add = (source: string, name: string) =>
    people.set(source, issueMention(source, name));
  if (issue) {
    add(
      issue.created_by,
      issue.created_by_name ||
        issue.created_by.replace(/^(human:|openagents:)/, ''),
    );
    issue.comments?.forEach((c) =>
      add(
        c.author,
        c.author_name || c.author.replace(/^(human:|openagents:)/, ''),
      ),
    );
    issue.threads?.forEach((thread) =>
      thread.agents.forEach((name) => add(`openagents:${name}`, name)),
    );
  }
  onlineUsers.forEach((user) => add(`human:${user.id}`, user.name));
  add(`human:${currentUser.id}`, currentUser.name);
  team.forEach((user) =>
    add(`human:${user.email}`, user.displayName || user.email),
  );
  agents.forEach((agent) =>
    add(`openagents:${agent.agentName}`, agentLabel(agent)),
  );
  return [...people.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) * -1 || a.name.localeCompare(b.name),
  );
}

export function mentionQuery(value: string, cursor: number) {
  // A fresh @ after whitespace/punctuation, never the @ inside an email.
  const match = /(?:^|[\s(])@([^\s@]*)$/.exec(value.slice(0, cursor));
  if (!match) return null;
  return { start: cursor - match[1].length - 1, end: cursor, query: match[1] };
}

export function insertIssueMention(
  value: string,
  range: { start: number; end: number },
  option: IssueMention,
) {
  const insertion = `@${option.token} `;
  return {
    value: value.slice(0, range.start) + insertion + value.slice(range.end),
    cursor: range.start + insertion.length,
  };
}

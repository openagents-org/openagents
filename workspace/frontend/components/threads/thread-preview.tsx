'use client';

import { Wrench } from 'lucide-react';
import { agentLabel } from '@/lib/helpers';
import { displayHumanMentions } from '@/lib/people-mentions';
import type { WorkspaceAgent } from '@/lib/types';
import type { useWorkspace } from '@/lib/workspace-context';
import { Spinner } from '@/components/ui/spinner';
import { highlightMatch, type SearchHit } from './thread-list-utils';

interface PreviewContext {
  isSearching: boolean;
  searchQuery: string;
  hitsByChannel: Map<string, SearchHit>;
  lastMessageBySession: ReturnType<typeof useWorkspace>['lastMessageBySession'];
  agents: WorkspaceAgent[];
  humanNames: Record<string, string>;
  t: (key: 'threads.noMessages' | 'threads.you') => string;
}

/** Last-message line for a thread: search snippet, tool status, or plain text. */
export function buildThreadPreview(sessionId: string, ctx: PreviewContext): { node: React.ReactNode; isStatus: boolean } {
  const { isSearching, searchQuery, hitsByChannel, lastMessageBySession, agents, humanNames, t } = ctx;
  const contentHit = hitsByChannel.get(sessionId);
  if (isSearching && contentHit) {
    const namedSnippet = displayHumanMentions(contentHit.snippet, humanNames);
    const snippet = namedSnippet.length > 80 ? `${namedSnippet.slice(0, 80)}...` : namedSnippet;
    return { node: highlightMatch(snippet, searchQuery), isStatus: false };
  }

  const lastMsg = lastMessageBySession[sessionId];
  if (!lastMsg || !lastMsg.content) return { node: t('threads.noMessages'), isStatus: false };

  const senderAgent = agents.find((a) => a.agentName === lastMsg.senderName);
  const sender = lastMsg.senderName === 'user'
    ? t('threads.you')
    : senderAgent ? agentLabel(senderAgent) : (humanNames[lastMsg.senderName.toLowerCase()] || lastMsg.senderName);
  // An unattributed waiting placeholder (several agents could answer) has
  // no sender — show the status alone rather than ": thinking...".
  const prefix = sender ? `${sender}: ` : '';
  if (!lastMsg.isStatus) return { node: `${prefix}${displayHumanMentions(lastMsg.content, humanNames)}`, isStatus: false };

  // Status lines get an icon instead of raw markdown
  const toolMatch = lastMsg.content.match(/Using tool:?\**\s*`?([^`\n]+)`?/i);
  if (toolMatch) {
    const cleanTool = toolMatch[1].trim().replace(/^mcp__[^_]+__/, '');
    return {
      node: <span className="flex items-center gap-1">{prefix}<Wrench className="size-3 shrink-0" /> {cleanTool}</span>,
      isStatus: true,
    };
  }
  if (lastMsg.content.includes('thinking')) {
    return {
      node: <span className="flex items-center gap-1">{prefix}<Spinner className="size-3 shrink-0" /> thinking...</span>,
      isStatus: true,
    };
  }
  const cleaned = lastMsg.content
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/```[\s\S]*/g, '')
    .trim();
  return { node: `${prefix}${cleaned}`, isStatus: true };
}

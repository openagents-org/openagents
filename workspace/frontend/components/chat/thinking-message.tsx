'use client';

import { AgentOwnershipBadge } from './agent-message-access';
import { memo } from 'react';
import { Trace } from '@/components/ui/trace';
import { ReasoningLine } from './reasoning-line';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';

interface ThinkingMessageProps {
  sender: string;
  messages: WorkspaceMessage[];
  agents?: WorkspaceAgent[];
  /** This is the thread's newest row, so the agent may still be thinking. */
  isActive?: boolean;
}

/** True for placeholder thinking with no real content. */
function isPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === '' || t === 'thinking...' || t === 'thinking';
}

/**
 * First-level "thinking" block. Unlike tool calls (which stay clustered at the
 * sub level in IntermediateSteps), an agent's reasoning is attributed to its
 * author (avatar + name) like a chat message; the reasoning itself is a
 * shadcn AI Elements Reasoning line that folds away once the agent moves on.
 */
export const ThinkingMessage = memo(function ThinkingMessage({ sender, messages, agents = [], isActive = false }: ThinkingMessageProps) {
  const agent = agents.find((a) => a.agentName === sender);

  // A thread can end on thinking when the agent drops off mid-turn; only a
  // connected agent can still be thinking, otherwise the spinner never stops.
  const running = isActive && agent?.status !== 'offline';

  const texts = messages.map((m) => m.content).filter((text) => text && !isPlaceholder(text));
  if (texts.length === 0) return null;

  const timestamp = messages[0]?.createdAt
    ? new Date(messages[0].createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="py-1.5">
      <div className="flex items-start gap-3">
        <AgentAvatar name={sender} size={32} className="opacity-70" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{agent ? agentLabel(agent) : sender}</span>
            {agent && <AgentOwnershipBadge agent={agent} />}
            {timestamp && (
              <span className="text-xs text-muted-foreground">{timestamp}</span>
            )}
          </div>
          <Trace>
            <ReasoningLine text={texts.join('\n\n')} running={running} />
          </Trace>
        </div>
      </div>
    </div>
  );
});

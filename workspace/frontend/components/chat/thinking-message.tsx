'use client';

import { memo } from 'react';
import { Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';

interface ThinkingMessageProps {
  sender: string;
  messages: WorkspaceMessage[];
  agents?: WorkspaceAgent[];
}

/** True for placeholder thinking with no real content. */
function isPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === '' || t === 'thinking...' || t === 'thinking';
}

/**
 * First-level "thinking" block. Unlike tool calls (which stay clustered at the
 * sub level in IntermediateSteps), an agent's reasoning is promoted to the same
 * level as chat messages and attributed to its author (avatar + name), while
 * still being visually muted so it reads as reasoning, not the final answer.
 */
export const ThinkingMessage = memo(function ThinkingMessage({ sender, messages, agents = [] }: ThinkingMessageProps) {
  const agent = agents.find((a) => a.agentName === sender);

  const texts = messages.map((m) => m.content).filter((t) => t && !isPlaceholder(t));
  if (texts.length === 0) return null;

  const timestamp = messages[0]?.createdAt
    ? new Date(messages[0].createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="py-1.5">
      <div className="flex items-start gap-2">
        <AgentAvatar name={sender} size={36} square className="mt-0.5 opacity-70" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-foreground truncate">{sender}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500/90 italic shrink-0">
              <Brain className="size-3.5" />
              thinking
            </span>
            {agent && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0',
                agent.role === 'master'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              )}>
                {agent.role}
              </span>
            )}
            {timestamp && (
              <span className="text-xs text-muted-foreground">{timestamp}</span>
            )}
          </div>
          <div className="mt-0.5 text-sm leading-relaxed text-foreground/60">
            {texts.length === 1 ? (
              <div className="whitespace-pre-wrap">{texts[0]}</div>
            ) : (
              // Multiple thinking chunks stream in over time; mark distinct
              // reasoning lines with a bullet. The bullet hangs in the left
              // gutter (absolute) so the text stays aligned with the agent
              // name above; the first line needs no bullet.
              <div className="space-y-2">
                {texts.map((t, i) => (
                  <div key={i} className="relative whitespace-pre-wrap">
                    {i > 0 && (
                      <span
                        aria-hidden
                        className="absolute -left-3 top-[11px] size-1.5 -translate-y-1/2 rounded-full bg-amber-500/50"
                      />
                    )}
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

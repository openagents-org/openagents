'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { MarkdownContent } from './markdown-content';
import type { WorkspaceAgent } from '@/lib/types';

interface WorkingBubbleProps {
  /** Agent the thread is waiting on — drives the avatar and the a11y label. */
  agentName?: string;
  agents?: WorkspaceAgent[];
  /** A short label for the current activity. */
  status?: string;
  task?: string;
  thought?: string;
  className?: string;
}

/**
 * "Agent is working" row: the responding agent's avatar and name, then a
 * muted Bubble with its current action and task, when the agent has reported one.
 */
export function WorkingBubble({ agentName, agents = [], status, task, thought, className }: WorkingBubbleProps) {
  const t = useT();
  const agent = agentName ? agents.find((a) => a.agentName === agentName) : undefined;
  const label = agent ? agentLabel(agent) : agentName;
  const [showFullThought, setShowFullThought] = useState(false);
  const thoughtId = useId();
  const thoughtText = thought?.trim() ?? '';
  const hasMoreThought = thoughtText.length > 600 || thoughtText.split('\n').length > 10;
  const collapsed = hasMoreThought && !showFullThought;

  return (
    <div
      className={cn('working-bubble flex items-start gap-3 py-1.5', className)}
      role="status"
      aria-label={label ? t('chat.agentWorkingNamed', { name: label }) : t('chat.agentWorking')}
    >
      {agentName ? (
        <AgentAvatar name={agentName} size={32} />
      ) : (
        <div className="size-8 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start">
        {/* Same name row as a posted message, so the bubble reads as that
            agent's message-in-progress. */}
        {label && (
          <span className="mb-1 truncate text-sm font-semibold text-foreground">{label}</span>
        )}
        <Bubble variant="muted" className="max-w-full">
          <BubbleContent className="flex flex-col gap-1 text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="inline-flex shrink-0 items-center gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="typing-dot size-1.5 rounded-full bg-current"
                    style={{ animationDelay: `${i * 0.16}s` }}
                  />
                ))}
              </span>
              <span className="min-w-0 break-words text-xs">{status || t('chat.stepsRunning')}</span>
            </div>
            {task && <p className="line-clamp-2 text-sm font-medium text-foreground" title={task}>{task}</p>}
            {thoughtText && (
              <div className="mt-1 min-w-0 max-w-prose border-t border-border/70 pt-2 text-sm">
                <p className="mb-1 text-xs font-medium">{t('chat.latestThought')}</p>
                <div id={thoughtId} className={cn('wrap-anywhere', collapsed && 'max-h-44 overflow-y-auto overscroll-contain')}>
                  <MarkdownContent content={thoughtText} agentNames={[]} excerptLimit={collapsed ? 600 : undefined} textOnlyImages />
                </div>
                {hasMoreThought && (
                  <button
                    type="button"
                    aria-expanded={showFullThought}
                    aria-controls={thoughtId}
                    className="mt-1.5 rounded-sm text-xs font-medium text-foreground underline-offset-4 hover:underline"
                    onClick={() => setShowFullThought(open => !open)}
                  >
                    {t(showFullThought ? 'common.showLess' : 'common.showMore')}
                  </button>
                )}
              </div>
            )}
          </BubbleContent>
        </Bubble>
      </div>
    </div>
  );
}

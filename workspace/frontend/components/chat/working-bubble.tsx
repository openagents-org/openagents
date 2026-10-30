'use client';

import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import type { WorkspaceAgent } from '@/lib/types';

interface WorkingBubbleProps {
  /** Agent the thread is waiting on — drives the avatar and the a11y label. */
  agentName?: string;
  agents?: WorkspaceAgent[];
  /** The agent's latest step ("Reading src/track.ts…", "Bash › git diff"). */
  status?: string;
  className?: string;
}

/**
 * "Agent is working" row: the responding agent's avatar and name, then a
 * speech bubble holding three lifting dots plus the agent's latest status step. Replaces the
 * old bar-ripple indicator; while this bubble is visible the step it shows is
 * not rendered as a separate row (see IntermediateSteps). Dots and fade-in are
 * pure CSS (`.typing-dot`, `.working-bubble` in globals.css) and respect
 * prefers-reduced-motion.
 */
export function WorkingBubble({ agentName, agents = [], status, className }: WorkingBubbleProps) {
  const t = useT();
  const agent = agentName ? agents.find((a) => a.agentName === agentName) : undefined;
  const label = agent ? agentLabel(agent) : agentName;

  return (
    <div
      className={cn('working-bubble flex items-start gap-3 py-1.5', className)}
      role="status"
      aria-label={label ? t('chat.agentWorkingNamed', { name: label }) : t('chat.agentWorking')}
    >
      {agentName ? (
        <AgentAvatar name={agentName} size={28} className="mt-0.5" />
      ) : (
        <div className="size-7 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start">
        {/* Same name row as a posted message, so the bubble reads as that
            agent's message-in-progress. */}
        {label && (
          <span className="mb-1 truncate text-sm font-semibold text-foreground">{label}</span>
        )}
        <div className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-xl rounded-tl-sm border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          <span className="inline-flex shrink-0 items-center gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="typing-dot size-1.5 rounded-full bg-current"
                style={{ animationDelay: `${i * 0.16}s` }}
              />
            ))}
          </span>
          {status && <span className="min-w-0 truncate">{status}</span>}
        </div>
      </div>
    </div>
  );
}

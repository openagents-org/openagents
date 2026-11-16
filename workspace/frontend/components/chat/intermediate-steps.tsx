'use client';

import { memo } from 'react';
import { Trace } from '@/components/ui/trace';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { WorkingBubble } from './working-bubble';
import { StepItem } from './step-item';
import { isPlaceholderThinking, parseStepContent } from './step-parsing';
import { isTerminalStatus } from './chat-message-groups';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { useT } from '@/lib/i18n';

/**
 * Whether "show all steps" would reveal anything. Thinking and todos show in
 * both views and a bare "thinking..." never gets a row of its own, so only a
 * real status/tool step that the latest-only view drops counts. Showing the
 * toggle without one made it look broken: an agent that had only said
 * "thinking..." so far offered the button, and clicking it changed nothing.
 * Mirrors the latest-only filter in ChatMessages.
 */
export function hasCollapsedSteps(messages: WorkspaceMessage[]): boolean {
  const list = messages.filter((m) => m.messageType !== 'loading');
  const isStep = (m: WorkspaceMessage) =>
    m.messageType === 'status' || m.messageType === 'thinking' || m.messageType === 'todos';
  const real = list.filter((m) => m.messageType === 'status' && m.content.trim() && !isPlaceholderThinking(m));
  if (real.length === 0) return false;
  // While the agent is still working (the thread ends on a step), the
  // latest-only view keeps the newest status after the last reply.
  let kept: WorkspaceMessage | undefined;
  for (let i = list.length - 1; i >= 0 && isStep(list[i]); i--) {
    if (list[i].messageType === 'status') { kept = list[i]; break; }
  }
  return real.some((m) => m !== kept);
}

// ── Intermediate Steps Group ──

interface IntermediateStepsProps {
  steps: WorkspaceMessage[];
  agents?: WorkspaceAgent[];
  isActive?: boolean;
}

export const IntermediateSteps = memo(function IntermediateSteps({ steps, agents, isActive = false }: IntermediateStepsProps) {
  const t = useT();
  if (steps.length === 0) return null;
  const hasTerminalStatus = steps.some(isTerminalStatus);
  const active = isActive && !hasTerminalStatus;

  // While the agent is active its most recent status / tool step moves into
  // the working bubble ("bubble with live status") instead of rendering as its
  // own row. Todos and real reasoning keep their rows; a bare "thinking..."
  // placeholder just yields the dots.
  let bubbleStatus: string | undefined;
  let absorbed: WorkspaceMessage | null = null;
  const lastStep = steps[steps.length - 1];
  if (active && lastStep && lastStep.messageType === 'status') {
    if (isPlaceholderThinking(lastStep)) {
      absorbed = lastStep;
    } else {
      const parsed = parseStepContent(lastStep.content);
      if (parsed.type === 'status') {
        bubbleStatus = parsed.text;
        absorbed = lastStep;
      } else if (parsed.type === 'tool_call') {
        bubbleStatus = parsed.summary ? `${parsed.toolDisplay} › ${parsed.summary}` : parsed.toolDisplay;
        absorbed = lastStep;
      } else if (parsed.type === 'compacting') {
        bubbleStatus = t('chat.vibing');
        absorbed = lastStep;
      }
    }
  }

  // Placeholder-only groups show nothing of their own; in history they vanish,
  // while active only the bubble appears.
  const rows = steps.filter((s) => s !== absorbed && !isPlaceholderThinking(s));
  if (rows.length === 0 && !active) return null;

  // Group consecutive steps by sender
  const hasMultipleAgents = (agents?.length ?? 0) > 1;
  const senderGroups: { sender: string; steps: WorkspaceMessage[] }[] = [];
  for (const step of rows) {
    const last = senderGroups[senderGroups.length - 1];
    if (last && last.sender === step.senderName) {
      last.steps.push(step);
    } else {
      senderGroups.push({ sender: step.senderName, steps: [step] });
    }
  }

  return (
    <div>
      {rows.length > 0 && (
        <div className="flex items-start gap-3 py-1">
          {/* Spacer matching avatar width for alignment with chat messages */}
          <div className="size-8 shrink-0" />
          <Trace className="min-w-0 flex-1 border-l-2 border-border py-0.5 pl-3">
            {senderGroups.map((group, gi) => (
              <div key={`${group.sender}-${gi}`} className="flex flex-col gap-1">
                {hasMultipleAgents && (
                  <div className="flex items-center gap-1.5">
                    <AgentAvatar name={group.sender} size={14} />
                    <span className="text-xs font-medium text-muted-foreground">
                      {(() => {
                        const a = agents?.find((x) => x.agentName === group.sender);
                        return a ? agentLabel(a) : group.sender;
                      })()}
                    </span>
                  </div>
                )}
                {group.steps.map((step) => (
                  <StepItem key={step.messageId} message={step} />
                ))}
              </div>
            ))}
          </Trace>
        </div>
      )}
      {active && (
        <WorkingBubble agentName={lastStep?.senderName} agents={agents} status={bubbleStatus} />
      )}
    </div>
  );
});

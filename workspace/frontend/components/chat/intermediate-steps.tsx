'use client';

import { memo } from 'react';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { WorkingBubble } from './working-bubble';
import { STEP_LINE, StepItem } from './step-item';
import { isPlaceholderThinking, parseStepContent } from './step-parsing';
import { isTerminalStatus } from './chat-message-groups';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { useT } from '@/lib/i18n';

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
  // The step still in progress, if the bubble did not take it (e.g. reasoning).
  const liveStep = active && !absorbed ? lastStep : null;
  if (rows.length === 0 && !active) return null;

  // Group consecutive steps by sender. Each todos message is a full snapshot
  // of that agent's list, so only its latest one shows.
  const hasMultipleAgents = (agents?.length ?? 0) > 1;
  const senderGroups: { sender: string; steps: WorkspaceMessage[]; todos?: WorkspaceMessage }[] = [];
  for (const step of rows) {
    let group = senderGroups[senderGroups.length - 1];
    if (!group || group.sender !== step.senderName) {
      group = { sender: step.senderName, steps: [] };
      senderGroups.push(group);
    }
    if (step.messageType === 'todos') group.todos = step;
    else group.steps.push(step);
  }

  return (
    <div>
      {rows.length > 0 && (
        <div className="flex items-start gap-3 py-1">
          {/* Spacer matching avatar width for alignment with chat messages */}
          <div className="size-8 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
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
                <Trace>
                  {group.steps.length > 0 && (
                    <StepsSummary steps={group.steps} running={active && gi === senderGroups.length - 1} liveStep={liveStep} />
                  )}
                  {group.todos && <StepItem message={group.todos} running={active && gi === senderGroups.length - 1} />}
                </Trace>
              </div>
            ))}
          </div>
        </div>
      )}
      {active && (
        <WorkingBubble agentName={lastStep?.senderName} agents={agents} status={bubbleStatus} />
      )}
    </div>
  );
});

/**
 * An agent's steps behind one summary line (shadcn AI Elements "Chain of
 * Thought"): "Working" while they run, then "Took N steps". It stays folded
 * while running too — the working bubble already shows the live step, and a
 * long run would otherwise unroll hundreds of rows.
 */
function StepsSummary({ steps, running, liveStep }: { steps: WorkspaceMessage[]; running: boolean; liveStep: WorkspaceMessage | null }) {
  const t = useT();
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine className={STEP_LINE} status={running ? 'running' : undefined}>
          <TraceIcon>
            {running ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <CircleCheck />}
          </TraceIcon>
          <TraceTitle>{running ? t('chat.stepsRunning') : t('chat.stepsDone', { count: steps.length })}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {steps.map((step) => (
            <StepItem key={step.messageId} message={step} running={running && step === liveStep} />
          ))}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

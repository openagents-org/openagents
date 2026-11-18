'use client';

import { memo } from 'react';
import { Activity, LoaderCircle } from 'lucide-react';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
} from '@/components/ui/trace';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { WorkingBubble } from './working-bubble';
import { StepItem } from './step-item';
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
  const lastAgent = agents?.find(agent => agent.agentName === steps[steps.length - 1].senderName);
  const active = isActive && !hasTerminalStatus && lastAgent?.status !== 'offline';

  // While the agent is active its most recent status / tool step moves into
  // the working bubble ("bubble with live status") instead of rendering as its
  // own row. Todos and real reasoning keep their rows; a bare "thinking..."
  // placeholder just yields the dots.
  let bubbleStatus: string | undefined;
  let absorbed: WorkspaceMessage | null = null;
  const lastStep = steps[steps.length - 1];
  if (active && lastStep?.messageType === 'thinking') bubbleStatus = t('chat.thinking');
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

  // A task message is a full snapshot. Keep only the latest per author,
  // including when other agents spoke between two snapshots.
  const latestTodos = new Map<string, WorkspaceMessage>();
  for (const step of rows) if (step.messageType === 'todos') latestTodos.set(step.senderName, step);
  const detailRows = rows.filter(step => step.messageType !== 'todos' || latestTodos.get(step.senderName) === step);
  const senderGroups: { sender: string; steps: WorkspaceMessage[] }[] = [];
  for (const step of detailRows) {
    let group = senderGroups[senderGroups.length - 1];
    if (!group || group.sender !== step.senderName) {
      group = { sender: step.senderName, steps: [] };
      senderGroups.push(group);
    }
    group.steps.push(step);
  }
  const senders = new Set(detailRows.map(step => step.senderName));
  const onlySender = senders.size === 1 ? detailRows[0]?.senderName : undefined;
  const author = agents?.find(agent => agent.agentName === onlySender);
  const taskCount = [...latestTodos.values()].reduce((count, message) =>
    count + (Array.isArray(message.metadata?.todos) ? message.metadata.todos.length : 0), 0);
  const stepCount = rows.filter(step => step.messageType !== 'todos').length;

  return (
    <div>
      {detailRows.length > 0 && (
        <div className="py-2 pl-11">
          <TraceCollapsible>
            <TraceCollapsibleTrigger className="gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/60">
              <TraceIcon>
                {active ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Activity />}
              </TraceIcon>
              <span className="min-w-0 truncate">
                {onlySender && <span className="mr-1.5 font-medium">{author ? agentLabel(author) : onlySender}</span>}
                {t(active ? 'chat.stepsRunning' : 'chat.activity')}
                {stepCount > 0 && <span className="text-muted-foreground/70"> · {t('chat.activitySteps', { count: stepCount })}</span>}
                {taskCount > 0 && <span className="text-muted-foreground/70"> · {t('chat.activityTasks', { count: taskCount })}</span>}
              </span>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent className="max-h-80 overflow-y-auto overscroll-contain py-1">
              {senderGroups.map((group, gi) => (
                <div key={`${group.sender}-${gi}`} className="mb-3 last:mb-0">
                  {senders.size > 1 && (
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <AgentAvatar name={group.sender} size={14} />
                      {(() => {
                        const agent = agents?.find(item => item.agentName === group.sender);
                        return agent ? agentLabel(agent) : group.sender;
                      })()}
                    </div>
                  )}
                  <Trace>
                    {group.steps.map(step => <StepItem key={step.messageId} message={step} running={active && step === liveStep} />)}
                  </Trace>
                </div>
              ))}
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </div>
      )}
      {active && <WorkingBubble agentName={lastStep?.senderName} agents={agents} status={bubbleStatus} />}
    </div>
  );
});

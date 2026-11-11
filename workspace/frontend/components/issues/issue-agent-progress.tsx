'use client';

import { ArrowUpRight } from 'lucide-react';
import { useMessagePolling } from '@/hooks/use-polling';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import type { IssueThread, WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import { WorkingBubble } from '@/components/chat/working-bubble';

/** Use only progress already published to the thread, and discard it after the agent's answer. */
export function latestIssueProgress(messages: WorkspaceMessage[], agentName: string) {
  const fromAgent = (message: WorkspaceMessage) => message.senderType === 'agent' &&
    (message.senderAddress?.replace(/^openagents:/, '') || message.senderId || message.senderName) === agentName;
  const lastRequest = messages.findLastIndex(message => message.senderType === 'human' || (!fromAgent(message) && message.targetAgents?.includes(agentName)));
  const isStep = (message: WorkspaceMessage) => ['status', 'thinking', 'todos'].includes(message.messageType);
  const finished = messages.some((message, index) => index > lastRequest && fromAgent(message) && !isStep(message));
  const index = messages.findLastIndex(fromAgent);
  const latest = messages[index];
  return { finished, step: latest && index > lastRequest && isStep(latest) ? latest : null };
}

export function IssueAgentProgress({ thread, agents }: { thread: IssueThread; agents: WorkspaceAgent[] }) {
  const { messages } = useMessagePolling({ sessionId: thread.channel_name });
  const { setCurrentSessionId } = useWorkspace();
  const { openView } = useLayout();
  const t = useT();
  const progress = agents.map(agent => ({ agent, ...latestIssueProgress(messages, agent.agentName) })).filter(item => !item.finished);
  if (!progress.length) return null;
  return <div className="thread-wip mt-6 space-y-2 rounded-xl border border-border/60 px-4 py-3">
    {progress.map(({ agent, step }) => <div key={agent.agentName}>
      <WorkingBubble agentName={agent.agentName} agents={agents} status={step?.messageType === 'status' ? step.content : t('chat.agentWorking')} />
      {step?.messageType === 'thinking' && step.content.trim() && <p className="ml-10 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-6 text-muted-foreground">{step.content}</p>}
    </div>)}
    <button type="button" className="ml-10 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      onClick={() => { setCurrentSessionId(thread.channel_name); openView('threads'); }}>
      {t('issues.openInThread')}<ArrowUpRight className="size-3" />
    </button>
  </div>;
}

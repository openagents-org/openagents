'use client';

import { ArrowRight, UsersRound } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';

export const routingBadgeClass = 'inline-flex h-[23px] max-w-full items-center gap-1.5 rounded-md border border-violet-200/60 bg-violet-50/50 px-1.5 text-[10px] leading-none text-violet-700/75 dark:border-violet-400/20 dark:bg-violet-400/5 dark:text-violet-300/80';
const neutralRoutingBadgeClass = `${routingBadgeClass} !border-border !bg-muted/25 !text-muted-foreground`;

export function RoutingPendingBadge() {
  const t = useT();
  return <span className={routingBadgeClass} role="status" aria-live="polite">
    <span className="routing-flow mr-1" aria-hidden="true">
      <span className="routing-flow-source" /><span className="routing-flow-track" />
      <span className="routing-flow-signal" /><span className="routing-flow-destination" />
    </span>
    {t('routing.routing')}
  </span>;
}

export function RoutedAgentBadge({ names, agents = [] }: { names: string[]; agents?: WorkspaceAgent[] }) {
  const t = useT();
  return <span className="inline-flex max-w-full flex-wrap gap-1" role="status" aria-label={t('routing.toAgent')}>
    {names.length ? names.map(name => {
      const agent = agents.find(a => a.agentName === name);
      return <span key={name} className={neutralRoutingBadgeClass} title={agent ? agentLabel(agent) : name}>
        <ArrowRight aria-hidden="true" className="size-3 shrink-0 opacity-60" strokeWidth={1.6} />
        <AgentAvatar name={name} size={14} /><span className="max-w-40 truncate">{agent ? agentLabel(agent) : name}</span>
      </span>;
    }) : <span className={neutralRoutingBadgeClass}><ArrowRight aria-hidden="true" className="size-3" />{t('routing.toAgent')}</span>}
  </span>;
}

export function ConversationBadge() {
  const t = useT();
  return <span className={neutralRoutingBadgeClass} aria-label={t('routing.toHuman')}>
    <ArrowRight aria-hidden="true" className="size-3 shrink-0 opacity-60" strokeWidth={1.6} />
    <UsersRound aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.6} />
    {t('routing.conversation')}
  </span>;
}

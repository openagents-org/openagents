'use client';

import { ArrowRight, UsersRound } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';

const neutralBadgeClass = 'max-w-full text-muted-foreground';

export function RoutingPendingBadge() {
  const t = useT();
  return <Badge variant="secondary" className="max-w-full" role="status" aria-live="polite">
    <span className="routing-flow mr-1" aria-hidden="true">
      <span className="routing-flow-source" /><span className="routing-flow-track" />
      <span className="routing-flow-signal" /><span className="routing-flow-destination" />
    </span>
    {t('routing.routing')}
  </Badge>;
}

export function RoutedAgentBadge({ names, agents = [] }: { names: string[]; agents?: WorkspaceAgent[] }) {
  const t = useT();
  return <span className="inline-flex max-w-full flex-wrap gap-1" role="status" aria-label={t('routing.toAgent')}>
    {names.length ? names.map(name => {
      const agent = agents.find(a => a.agentName === name);
      return <Badge key={name} variant="outline" className={neutralBadgeClass} title={agent ? agentLabel(agent) : name}>
        <ArrowRight aria-hidden="true" className="opacity-60" strokeWidth={1.6} />
        <AgentAvatar name={name} size={14} /><span className="max-w-40 truncate">{agent ? agentLabel(agent) : name}</span>
      </Badge>;
    }) : <Badge variant="outline" className={neutralBadgeClass}><ArrowRight aria-hidden="true" />{t('routing.toAgent')}</Badge>}
  </span>;
}

export function ConversationBadge() {
  const t = useT();
  return <Badge variant="outline" className={neutralBadgeClass} aria-label={t('routing.toHuman')}>
    <ArrowRight aria-hidden="true" className="opacity-60" strokeWidth={1.6} />
    <UsersRound aria-hidden="true" strokeWidth={1.6} />
    {t('routing.conversation')}
  </Badge>;
}

'use client';
import { useState } from 'react';
import { ChevronRight, Settings } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/responsive-dialog';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { dmSessionId, myAddress } from '@/lib/dm';
import type { WorkspaceAgent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { WithTooltip } from '@/components/ui/with-tooltip';

export function MoreAgents({ agents, moreOnline, owned, showLabels = true, onNavigate }: {
  agents: WorkspaceAgent[]; moreOnline: number; owned: boolean; showLabels?: boolean; onNavigate?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { currentUser, setCurrentSessionId } = useWorkspace();
  const { setSelectedAgentName, openView, setThreadFilter, openMobileDetail } = useLayout();
  const title = t(owned ? 'nav.myAgents' : 'collab.sharedByOthers');
  const label = moreOnline > 0 ? t('nav.moreAgentsOnline', { count: moreOnline }) : t('nav.viewAllAgents');
  const candidates = agents.filter(agent => `${agentLabel(agent)} ${agent.agentName}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <SidebarMenuItem>
    <SidebarMenuButton
      size="sm"
      className={cn('text-muted-foreground', !showLabels && 'justify-center!')}
      aria-label={`${title}: ${label}`}
      tooltip={{ children: `${title}: ${label}`, hidden: showLabels }}
      onClick={() => { setQuery(''); setOpen(true); }}
    >
      {showLabels && <span className="flex-1">{label}</span>}<ChevronRight />
    </SidebarMenuButton>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md">
      {/* Search sits in the pinned header (a focus ring at the top of the
          scrolling body gets clipped); the list scrolls in DialogBody alone. */}
      <DialogHeader className="gap-3">
        <DialogTitle>{title} · {agents.length}</DialogTitle>
        <Input autoFocus aria-label={t('nav.searchAgents')} placeholder={t('nav.searchAgents')} value={query} onChange={event => setQuery(event.target.value)} />
      </DialogHeader>
      <DialogBody>
        <div className="flex flex-col">{candidates.map(agent => <div key={agent.agentName} className="flex items-center gap-1">
          <Item size="sm" asChild>
            <button type="button" className="min-w-0 flex-1 text-left hover:bg-muted" onClick={() => {
              setSelectedAgentName(null); setCurrentSessionId(dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`));
              openView('threads'); setThreadFilter('all'); openMobileDetail(); setOpen(false); onNavigate?.();
            }}>
              <ItemMedia><AgentAvatar name={agent.agentName} size={24} status={agent.status} showStatus /></ItemMedia>
              <ItemContent className="min-w-0"><ItemTitle className="max-w-full truncate font-normal">{agentLabel(agent)}</ItemTitle></ItemContent>
            </button>
          </Item>
          <WithTooltip label={t('nav.agentSettings', { name: agentLabel(agent) })}>
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={t('nav.agentSettings', { name: agentLabel(agent) })} onClick={() => { setSelectedAgentName(agent.agentName); openMobileDetail(); setOpen(false); onNavigate?.(); }}><Settings /></Button>
          </WithTooltip>
        </div>)}{!candidates.length && <p className="p-2 text-sm text-muted-foreground">{t('nav.noAgentsFound')}</p>}</div>
      </DialogBody>
    </DialogContent></Dialog>
  </SidebarMenuItem>;
}

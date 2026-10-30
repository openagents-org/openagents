'use client';
import { useState } from 'react';
import { ChevronRight, Settings } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/responsive-dialog';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { dmSessionId, myAddress } from '@/lib/dm';
import type { WorkspaceAgent } from '@/lib/types';

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
  return <li>
    <button type="button" title={`${title}: ${label}`} aria-label={`${title}: ${label}`} className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent" onClick={() => { setQuery(''); setOpen(true); }}>
      {showLabels && <span className="flex-1 text-left">{label}</span>}<ChevronRight className="size-3.5 shrink-0" />
    </button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{title} · {agents.length}</DialogTitle></DialogHeader>
      <DialogBody className="space-y-3">
        <Input autoFocus aria-label={t('nav.searchAgents')} placeholder={t('nav.searchAgents')} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="max-h-80 overflow-y-auto">{candidates.map(agent => <div key={agent.agentName} className="flex items-center gap-1 rounded-md hover:bg-muted">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left" onClick={() => {
            setSelectedAgentName(null); setCurrentSessionId(dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`));
            openView('threads'); setThreadFilter('dms'); openMobileDetail(); setOpen(false); onNavigate?.();
          }}><AgentAvatar name={agent.agentName} size={24} status={agent.status} showStatus /><span className="truncate text-sm">{agentLabel(agent)}</span></button>
          <button type="button" className="m-1 rounded p-2 text-muted-foreground hover:bg-muted" title={t('nav.agentSettings', { name: agentLabel(agent) })} aria-label={t('nav.agentSettings', { name: agentLabel(agent) })} onClick={() => { setSelectedAgentName(agent.agentName); openMobileDetail(); setOpen(false); onNavigate?.(); }}><Settings className="size-4" /></button>
        </div>)}{!candidates.length && <p className="p-2 text-sm text-muted-foreground">{t('nav.noAgentsFound')}</p>}</div>
      </DialogBody>
    </DialogContent></Dialog>
  </li>;
}

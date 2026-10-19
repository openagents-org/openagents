'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Bot, Loader2, UserRound, UsersRound } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogDescription } from '@/components/ui/responsive-dialog';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { WorkspaceMessage } from '@/lib/types';

export function messageAudience(message: WorkspaceMessage): 'human' | 'agent' | 'pending' | null {
  if (message.messageId.startsWith('optimistic-') || message.sessionId.startsWith('dm:') || message.metadata.recalled
      || message.metadata.approval_id || message.metadata.approval || message.messageType !== 'chat') return null;
  const choice = message.metadata.routing_choice as { status?: string } | undefined;
  if (choice?.status === 'assigned') return 'agent';
  if (choice?.status === 'pending') return 'pending';
  if (message.targetAgents?.some(name => name !== '__no_response__')) return 'agent';
  return message.targetAgents?.length === 1 && message.targetAgents[0] === '__no_response__' ? 'human' : null;
}

export function MessageAudience({ message, isSender }: { message: WorkspaceMessage; isSender: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ name: string; label: string }[] | null>(null);
  const [assigned, setAssigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  useEffect(() => { setAssigned(false); setOpen(false); }, [message.messageId]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setOptions(null); setError('');
    Promise.all([workspaceApi.getChannelParticipants(message.sessionId), workspaceApi.discover()])
      .then(([participants, discovery]) => {
        if (!active) return;
        const members = new Set(participants.agents.map(agent => agent.agent_name));
        setOptions(discovery.agents.filter(agent => agent.status === 'online')
          .map(agent => ({ name: agent.address.replace(/^openagents:/, ''), label: agent.display_name?.trim() || agent.address.replace(/^openagents:/, '') }))
          .filter(agent => members.has(agent.name)));
      }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [open, message.sessionId]);
  const audience = assigned ? 'agent' : messageAudience(message);
  if (!audience) return null;
  const label = t(audience === 'human' ? 'routing.toHuman' : audience === 'agent' ? 'routing.toAgent' : 'routing.chooseAgent');
  const Icon = audience === 'human' ? UserRound : audience === 'agent' ? Bot : UsersRound;
  const style = 'inline-flex h-5 shrink-0 items-center justify-center gap-0.5 self-center rounded px-0.5 text-muted-foreground/60 transition-colors';
  async function choose(agent: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await workspaceApi.resolveRoutingChoice(message.messageId, agent, true);
      if (result.status === 'assigned') { setAssigned(true); setOpen(false); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (audience !== 'human' || !isSender) return <span className={style} role="img" aria-label={label} title={label}><ArrowRight aria-hidden="true" className="size-2.5" strokeWidth={1.6} /><Icon aria-hidden="true" className="size-3" strokeWidth={1.6} /></span>;
  return <>
    <button type="button" className={`${style} hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-ring`}
      aria-label={label} title={`${label} · ${t('routing.reclassifyHint')}`} onClick={() => setOpen(true)}><ArrowRight aria-hidden="true" className="size-2.5" strokeWidth={1.6} /><Icon aria-hidden="true" className="size-3" strokeWidth={1.6} /></button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent className="gap-0 overflow-hidden sm:max-w-[400px]">
        <DialogHeader className="space-y-2 border-b px-5 pt-5 pb-4 text-start">
          <DialogTitle className="pr-7 text-base leading-6">{t('routing.assignTitle')}</DialogTitle>
          <DialogDescription className="pr-5 text-xs leading-5">{t('routing.assignHint')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-1 p-2 pb-3">
          {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
          {!options && !error && <div className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</div>}
          {options?.map(agent => <button key={agent.name} type="button" disabled={busy} aria-label={agent.label}
            className="group flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={() => void choose(agent.name)}>
            <AgentAvatar name={agent.name} size={32} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{agent.label}</span><span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-500/80" />{t('routing.onlineInThread')}</span></span>
            {busy ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground" /> : <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground/40 transition-colors group-hover:text-foreground" />}
          </button>)}
          {options?.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('routing.noOnlineAgents')}</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  </>;
}

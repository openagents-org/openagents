'use client';

import { useEffect, useRef, useState } from 'react';
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
  const style = 'rounded px-1 text-[10px] font-normal text-muted-foreground/70';
  async function choose(agent: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await workspaceApi.resolveRoutingChoice(message.messageId, agent, true);
      if (result.status === 'assigned') { setAssigned(true); setOpen(false); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (audience !== 'human' || !isSender) return <span className={style}>{label}</span>;
  return <>
    <button type="button" className={`${style} hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-ring`}
      title={t('routing.reclassifyHint')} onClick={() => setOpen(true)}>{label}</button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('routing.title')}</DialogTitle><DialogDescription>{t('routing.reclassifyHint')}</DialogDescription></DialogHeader>
        <DialogBody className="space-y-2">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!options && !error && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
          {options?.map(agent => <button key={agent.name} type="button" disabled={busy}
            className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50" onClick={() => void choose(agent.name)}>{agent.label}</button>)}
          {options?.length === 0 && <p className="text-sm text-muted-foreground">{t('routing.noOnlineAgents')}</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  </>;
}

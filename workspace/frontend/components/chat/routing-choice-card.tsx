'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';

interface RoutingChoice {
  status: string;
  requester_email: string;
  candidates: string[];
}
function choiceFrom(message: WorkspaceMessage): RoutingChoice | null {
  const value = message.metadata.routing_choice as Partial<RoutingChoice> | undefined;
  return value && typeof value.status === 'string' && typeof value.requester_email === 'string' && Array.isArray(value.candidates)
    ? value as RoutingChoice : null;
}

export function RoutingChoiceCard({ message, agents }: { message: WorkspaceMessage; agents: WorkspaceAgent[] }) {
  const { currentUser } = useWorkspace();
  const t = useT();
  const initial = choiceFrom(message);
  const [status, setStatus] = useState(initial?.status);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => { setStatus(initial?.status); }, [message.messageId, initial?.status]);
  if (!initial || initial.requester_email.toLowerCase() !== currentUser.id.toLowerCase() || status !== 'pending') return null;
  const choose = async (agent: string | null) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await workspaceApi.resolveRoutingChoice(message.messageId, agent);
      setStatus(result.status);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <section aria-label={t('routing.title')} className="relative mt-3 max-w-xl rounded-xl border bg-muted/25 p-3">
    <button type="button" aria-label={t('routing.dismiss')} disabled={busy} onClick={() => void choose(null)} className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"><X className="size-3.5" /></button>
    <p className="pr-7 text-xs font-medium">{t('routing.title')}</p>
    <p className="mt-1 pr-5 text-[11px] leading-5 text-muted-foreground">{t('routing.hint')}</p>
    <div className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
      {initial.candidates.filter(name => typeof name === 'string').map(name => {
        const agent = agents.find(a => a.agentName === name);
        return <button type="button" key={name} disabled={busy} onClick={() => void choose(name)} className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          <AgentAvatar name={name} size={20} /><span className="truncate">{agent ? agentLabel(agent) : name}</span><ArrowRight className="size-3 text-muted-foreground" />
        </button>;
      })}
    </div>
    <button type="button" disabled={busy} onClick={() => void choose(null)} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"><X aria-hidden="true" className="size-3.5" />{t('routing.dismissAction')}</button>
    {busy && <Loader2 aria-label={t('common.saving')} className="ml-2 inline size-3 animate-spin" />}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </section>;
}

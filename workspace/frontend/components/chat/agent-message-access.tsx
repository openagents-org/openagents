"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useT } from '@/lib/i18n';
import type { ChannelParticipants, WorkspaceAgent } from '@/lib/types';
import { toast } from 'sonner';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';

type Access = ChannelParticipants['agents'][number];
const Context = createContext<{ data: ChannelParticipants | null; people: number; supported: boolean; agents: Access[]; request: (agent: Access) => Promise<void>; busy: string | null } | null>(null);

/** One participant/access refresh per conversation, shared by all message rows. */
export function AgentMessageAccessProvider({ children }: { children: ReactNode }) {
  const { currentSessionId, currentUser, workspace, pendingApprovals } = useWorkspace();
  const confirm = useConfirm();
  const t = useT();
  const key = `${workspace?.workspaceId}:${currentUser.id}:${currentSessionId}`;
  const [state, setState] = useState<{ key: string; value: ChannelParticipants } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const currentKey = useRef(key);
  currentKey.current = key;
  const approvalKey = (pendingApprovals || []).map(item => item.id).join(',');
  useEffect(() => {
    if (!currentSessionId || currentSessionId.startsWith('dm:')) return;
    let active = true;
    const refresh = async () => {
      try {
        const value = await workspaceApi.getChannelParticipants(currentSessionId);
        if (active) setState({ key, value });
      } catch { if (active) setState(null); }
    };
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(THREAD_PARTICIPANTS_CHANGED, onChange);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30000);
    return () => { active = false; clearInterval(timer); window.removeEventListener(THREAD_PARTICIPANTS_CHANGED, onChange); };
  }, [key, currentSessionId, approvalKey]);
  const data = state?.key === key ? state.value : null;
  const request = async (agent: Access) => {
    if (pending.current || !currentSessionId || !data?.thread_access_requests_supported) return;
    pending.current = true;
    try {
      const accepted = await confirm({ title: t('messageAgentAccess.requestTitle', { agent: agent.display_name || agent.agent_name }),
        description: t('messageAgentAccess.requestHint', { owner: agent.owner_display_name || agent.owner_email || '', agent: agent.display_name || agent.agent_name }),
        confirmText: t('messageAgentAccess.request') });
      if (!accepted || currentKey.current !== key) return;
      setBusy(agent.agent_name);
      await workspaceApi.requestThreadAgentAccess(currentSessionId, agent.agent_name);
      if (currentKey.current !== key) return;
      setState(previous => previous?.key === key ? { key, value: { ...previous.value, agents: previous.value.agents.map(item => item.agent_name === agent.agent_name ? { ...item, thread_access_requested: true } : item) } } : previous);
      toast.success(t('messageAgentAccess.sent'));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('messageAgentAccess.failed')); }
    finally { pending.current = false; setBusy(null); }
  };
  return <Context.Provider value={{ data, supported: !!data?.thread_access_requests_supported, people: data?.humans.length || 0, agents: data?.agents || [], request, busy }}>{children}</Context.Provider>;
}

export function AgentOwnershipBadge({ agent, compact = false }: { agent: WorkspaceAgent; compact?: boolean }) {
  const context = useContext(Context);
  const { currentUser } = useWorkspace();
  const t = useT();
  if (!context || agent.builtin) return null;
  const access = context.agents.find(item => item.agent_name === agent.agentName);
  const owner = access?.owner_email || agent.ownerEmail;
  if (!owner) return null;
  const mine = owner.toLowerCase() === currentUser.id.toLowerCase();
  const status = mine ? t('messageAgentAccess.yours') : access?.request_access === 'yes' ? t('messageAgentAccess.shared') : access?.request_access === 'approval' ? t('messageAgentAccess.approval') : access?.request_access === 'no' ? t('messageAgentAccess.notShared') : '';
  const label = `${access?.owner_display_name || owner}${mine ? ` (${t('threads.you')})` : ''}`;
  return <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground" title={t('messageAgentAccess.owner', { name: label })}>
    {!compact && <span className="max-w-44 truncate">{t('messageAgentAccess.owner', { name: label })}</span>}
    {status && <span className="rounded bg-muted px-1.5 py-0.5">{status}</span>}
  </span>;
}

export function AgentSharingAction({ agentName }: { agentName: string }) {
  const context = useContext(Context);
  const t = useT();
  const agent = context?.agents.find(item => item.agent_name === agentName);
  if (!context || context.people < 2 || !agent?.can_request_sharing || agent.request_access !== 'no') return null;
  return <button type="button" title={context.supported ? undefined : t('messageAgentAccess.rolloutPending')} disabled={!context.supported || !!context.busy || agent.thread_access_requested} onClick={() => void context.request(agent)} className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
    <UserPlus className="size-3" />{agent.thread_access_requested ? t('messageAgentAccess.requested') : t('messageAgentAccess.request')}
  </button>;
}


export function useThreadCollaboration() {
  const context = useContext(Context);
  const { currentUser } = useWorkspace();
  return {
    supported: !!context?.data?.collaboration_supported,
    roles: context?.data?.collaboration || {},
    canEdit: (agent: WorkspaceAgent) => !!context?.data?.collaboration_supported && !!context.data.is_participant && (!!context.data.can_manage || agent.ownerEmail?.toLowerCase() === currentUser.id?.toLowerCase()),
  };
}

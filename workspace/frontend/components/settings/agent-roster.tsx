'use client';

// ── v1.1 M1 — agents half of the unified Members roster ──────────────────────
// The people list above it is unchanged; this section lists every agent from
// discover with ownership, sharing and availability. Connected agents inherit
// their device connection owner; sharing is managed through Services.

import { useCallback, useEffect, useState } from 'react';
import { Cloud, Monitor, UserRoundPlus } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import {
  SelectGroup, Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListEmpty, ListLoading, SettingsList } from '@/components/settings/settings-list';
import { workspaceApi } from '@/lib/api';
import { networkAgentToWorkspaceAgent } from '@/lib/types';
import type { AgentVisibility, TeamMember, WorkspaceAgent, WorkspaceMe } from '@/lib/types';
import { agentLabel } from '@/lib/helpers';
import {
  agentAvailability,
  apiErrorStatus,
  availabilityLabel,
  canClaimAgent,
  canManageAgent,
  displayNameFromEmail,
  type AgentAvailability,
} from '@/lib/collab';
import { useT } from '@/lib/i18n';

const NO_OWNER = '__none__';

/** Availability as a status badge: ready, working, needs a person, unreachable. */
const AVAILABILITY_BADGE: Record<AgentAvailability, 'success' | 'info' | 'warning' | 'destructive' | 'secondary'> = {
  online: 'success',
  busy: 'info',
  waiting: 'warning',
  device_offline: 'destructive',
  offline: 'secondary',
};

export function AgentRoster({ me, members }: { me: WorkspaceMe; members: TeamMember[] }) {
  const t = useT();
  const [agents, setAgents] = useState<WorkspaceAgent[] | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const discovery = await workspaceApi.discover();
      setAgents(discovery.agents.map(networkAgentToWorkspaceAgent));
    } catch {
      setAgents([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const memberName = (email: string | null | undefined) => {
    if (!email) return '';
    return members.find((m) => m.email === email)?.displayName || displayNameFromEmail(email);
  };

  const patch = async (
    agent: WorkspaceAgent,
    updates: { owner_email?: string; visibility?: AgentVisibility },
    successKey: 'collab.ownerSaved' | 'collab.visibilitySaved',
  ) => {
    setBusyAgent(agent.agentName);
    // Optimistic: the picker shows the new value right away.
    setAgents((prev) => prev?.map((a) => (
      a.agentName === agent.agentName
        ? {
            ...a,
            ...(updates.owner_email !== undefined ? { ownerEmail: updates.owner_email || null } : {}),
            ...(updates.visibility !== undefined ? { visibility: updates.visibility } : {}),
          }
        : a
    )) ?? prev);
    try {
      await workspaceApi.updateAgentProfile(agent.agentName, updates);
      toast.success(t(successKey));
    } catch (e) {
      const status = apiErrorStatus(e);
      toast.error(
        status === 403 ? t('collab.saveForbidden')
          : status === 400 && updates.visibility === 'personal' ? t('collab.personalNeedsOwner')
            : t('collab.saveFailed'),
      );
      await load();
    } finally {
      setBusyAgent(null);
    }
  };

  return (
    <SettingsCard title={t('collab.agentsSection')} description={t('collab.agentsSectionDescription')}>
      {agents === null ? (
        <ListLoading />
      ) : agents.length === 0 ? (
        <ListEmpty>{t('collab.noAgentsYet')}</ListEmpty>
      ) : (
        <SettingsList>
          {agents.map((agent) => {
            const manage = canManageAgent(me, agent.ownerEmail);
            const claim = !manage && canClaimAgent(me, agent.ownerEmail);
            const availability = agentAvailability(agent);
            const isCloud = !!agent.agentType?.startsWith('cloud:');
            const busy = busyAgent === agent.agentName;
            const ownerOptions = Array.from(new Set([
              ...members.map((m) => m.email),
              ...(agent.ownerEmail ? [agent.ownerEmail] : []),
            ]));

            return (
              <Item key={agent.agentName} size="sm">
                <ItemMedia>
                  <AgentAvatar name={agent.agentName} size={32} />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    <span className="truncate">{agentLabel(agent)}</span>
                    <Badge variant="outline">{t('collab.kindAgent')}</Badge>
                  </ItemTitle>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {agent.agentType && <span className="capitalize">{agent.agentType.replace('cloud:', '')}</span>}
                    <Badge variant={AVAILABILITY_BADGE[availability]}>
                      {availabilityLabel(t, availability, agent.queueDepth ?? 0)}
                    </Badge>
                    <span className="inline-flex items-center gap-1">
                      {isCloud ? <Cloud className="size-3" /> : <Monitor className="size-3" />}
                      {isCloud ? t('collab.cloud') : (agent.runtimeName || agent.nodeId || t('collab.device'))}
                    </span>
                  </div>
                </ItemContent>

                <ItemActions className="flex-wrap">
                  {/* Owner */}
                  {manage && !agent.nodeId ? (
                    <Select
                      value={agent.ownerEmail || NO_OWNER}
                      disabled={busy}
                      onValueChange={(v) => patch(agent, { owner_email: v === NO_OWNER ? '' : v }, 'collab.ownerSaved')}
                    >
                      <SelectTrigger size="sm" className="w-44 text-xs" aria-label={t('collab.owner')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup><SelectItem value={NO_OWNER}>{t('collab.ownerNone')}</SelectItem>
                        {ownerOptions.map((email) => (
                          <SelectItem key={email} value={email}>{memberName(email) || email}</SelectItem>
                        ))}</SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : claim ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => me.email && patch(agent, { owner_email: me.email }, 'collab.ownerSaved')}
                    >
                      <UserRoundPlus data-icon="inline-start" />
                      {t('collab.claimAgent')}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {agent.ownerEmail ? t('collab.ownedBy', { owner: memberName(agent.ownerEmail) }) : t('collab.ownerNone')}
                    </span>
                  )}

                  <Badge variant={agent.visibility === 'personal' ? 'info' : 'secondary'}>
                    {agent.visibility === 'personal' ? t('collab.visibilityPersonal') : t('collab.visibilityTeam')}
                  </Badge>
                  {busy && <Spinner className="size-3.5 text-muted-foreground" />}
                </ItemActions>
              </Item>
            );
          })}
        </SettingsList>
      )}
    </SettingsCard>
  );
}

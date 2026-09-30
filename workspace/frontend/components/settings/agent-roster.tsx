'use client';

// ── v1.1 M1 — agents half of the unified Members roster ──────────────────────
// The people list above it is unchanged; this section lists every agent from
// discover with owner / visibility / status-runtime / node. Owners, admins and
// the agent's own owner may change owner and Personal/Team (PATCH members); a
// member may claim an unowned agent.

import { useCallback, useEffect, useState } from 'react';
import { Cloud, Loader2, Monitor, UserRoundPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { cn } from '@/lib/utils';
import { workspaceApi } from '@/lib/api';
import { networkAgentToWorkspaceAgent } from '@/lib/types';
import type { AgentVisibility, TeamMember, WorkspaceAgent, WorkspaceMe } from '@/lib/types';
import { agentLabel } from '@/lib/helpers';
import {
  agentAvailability,
  apiErrorStatus,
  availabilityDotClass,
  availabilityLabel,
  canClaimAgent,
  canManageAgent,
  displayNameFromEmail,
} from '@/lib/collab';
import { useT } from '@/lib/i18n';

const NO_OWNER = '__none__';

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
    <div className="space-y-2">
      <div>
        <Label variant="secondary">{t('collab.agentsSection')}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('collab.agentsSectionDescription')}</p>
      </div>

      {agents === null ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t('collab.noAgentsYet')}</p>
      ) : (
        <div className="divide-y rounded-lg border">
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
              <div key={agent.agentName} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <AgentAvatar name={agent.agentName} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <span className="truncate">{agentLabel(agent)}</span>
                      <Badge variant="outline" size="xs" className="shrink-0">{t('collab.kindAgent')}</Badge>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {agent.agentType && <span className="capitalize">{agent.agentType.replace('cloud:', '')}</span>}
                      <span className="inline-flex items-center gap-1">
                        <span className={cn('size-1.5 rounded-full', availabilityDotClass(availability))} />
                        {availabilityLabel(t, availability, agent.queueDepth ?? 0)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        {isCloud ? <Cloud className="size-3" /> : <Monitor className="size-3" />}
                        {isCloud ? t('collab.cloud') : (agent.runtimeName || agent.nodeId || t('collab.device'))}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {/* Owner */}
                  {manage ? (
                    <Select
                      value={agent.ownerEmail || NO_OWNER}
                      disabled={busy}
                      onValueChange={(v) => patch(agent, { owner_email: v === NO_OWNER ? '' : v }, 'collab.ownerSaved')}
                    >
                      <SelectTrigger className="h-8 w-44 shrink-0 text-xs" aria-label={t('collab.owner')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_OWNER}>{t('collab.ownerNone')}</SelectItem>
                        {ownerOptions.map((email) => (
                          <SelectItem key={email} value={email}>{memberName(email) || email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : claim ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => me.email && patch(agent, { owner_email: me.email }, 'collab.ownerSaved')}
                    >
                      <UserRoundPlus className="size-3.5" />
                      {t('collab.claimAgent')}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {agent.ownerEmail ? t('collab.ownedBy', { owner: memberName(agent.ownerEmail) }) : t('collab.ownerNone')}
                    </span>
                  )}

                  {/* Visibility */}
                  {manage ? (
                    <Select
                      value={agent.visibility || 'team'}
                      disabled={busy}
                      onValueChange={(v) => patch(agent, { visibility: v as AgentVisibility }, 'collab.visibilitySaved')}
                    >
                      <SelectTrigger className="h-8 w-28 shrink-0 text-xs" aria-label={t('collab.visibility')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="team">{t('collab.visibilityTeam')}</SelectItem>
                        <SelectItem value="personal">{t('collab.visibilityPersonal')}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      variant={agent.visibility === 'personal' ? 'info' : 'secondary'}
                      appearance="light"
                      size="sm"
                    >
                      {agent.visibility === 'personal' ? t('collab.visibilityPersonal') : t('collab.visibilityTeam')}
                    </Badge>
                  )}
                  {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

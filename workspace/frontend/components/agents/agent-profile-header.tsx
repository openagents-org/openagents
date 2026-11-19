'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { DeviceOfflineHint } from '@/components/agents/agent-roster-hints'; // v1.1 M1
import { AgentUsabilityLine } from '@/components/sharing/agent-access-section';
import { AccessExplainer } from '@/components/sharing/access-explainer';
import { workspaceApi } from '@/lib/api';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WorkspaceAgent } from '@/lib/types';

/**
 * Avatar, name and status. The display name is edited inline: any script is
 * allowed (the ASCII agentName stays the @mention token); empty clears back to
 * agentName.
 */
export function AgentProfileHeader({ agent, canManage, refreshWorkspace }: { agent: WorkspaceAgent; canManage: boolean; refreshWorkspace: () => Promise<void> }) {
  const t = useT();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    setEditingName(false);
    setNameDraft(agent.displayName || '');
  }, [agent.agentName, agent.displayName]);

  const handleSaveDisplayName = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (trimmed === (agent.displayName || '')) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await workspaceApi.updateMember(agent.agentName, { display_name: trimmed });
      await refreshWorkspace();
      setEditingName(false);
      toast.success(t('agents.displayNameSaved'));
    } catch (err) {
      // Surface the server's reason (length cap, clash with another agent's name)
      const raw = err instanceof Error ? err.message : '';
      const detail = raw.match(/"message"\s*:\s*"([^"]+)"/)?.[1];
      toast.error(detail || t('agents.displayNameSaveFailed'));
    } finally {
      setSavingName(false);
    }
  }, [agent, nameDraft, refreshWorkspace, t]);

  const isOnline = agent.status === 'online';
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <AgentAvatar name={agent.agentName} size={44} status={agent.status} showStatus />
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') handleSaveDisplayName();
                  if (e.key === 'Escape') { setEditingName(false); setNameDraft(agent.displayName || ''); }
                }}
                placeholder={agent.agentName}
                maxLength={64}
                className="h-7 min-w-0 flex-1 px-1.5 text-sm font-semibold"
                autoFocus
              />
              <Button onClick={handleSaveDisplayName} disabled={savingName} size="xs" className="shrink-0">
                {savingName ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          ) : (
            <div className="group/name flex min-w-0 items-center gap-1.5">
              <h3 className="truncate text-lg leading-tight font-semibold">{agentLabel(agent)}</h3>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setEditingName(true)}
                  className="text-muted-foreground hover:text-foreground"
                  title={t('agents.editDisplayName')}
                  aria-label={t('agents.editDisplayName')}
                >
                  <Pencil />
                </Button>
              )}
            </div>
          )}
          {agent.displayName && agent.displayName !== agent.agentName && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">@{agent.agentName}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={isOnline ? 'success' : 'secondary'}>
              <span className={cn('size-1.5 rounded-full', isOnline ? 'bg-success' : 'bg-muted-foreground/60')} />
              {agent.status}
            </Badge>
            {/* Permission model v1.1: who can use it (replaces the personal badge) */}
            <AgentUsabilityLine agentName={agent.agentName} />
            <DeviceOfflineHint agent={agent} withLabel />
            <AccessExplainer resourceKind="agent" resourceId={agent.agentName} className="basis-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

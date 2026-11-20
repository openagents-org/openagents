'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';
import { ProfileSection } from './agent-profile-section';

const HINT = 'text-xs leading-relaxed text-muted-foreground';

/**
 * Where a device agent works, and on which device. Read-only here: the device
 * recreates the agent at a new path (see configure_agent in the connector), so
 * the change goes through the agent's full settings, which carry its
 * credentials and model over and report a failure in place. Only the device
 * connection's owner may change its agents, and a device agent's owner is
 * that connection's owner, so the button is for agents you own.
 */
export function WorkdirCard({ agent, canManage }: { agent: WorkspaceAgent; canManage: boolean }) {
  const t = useT();
  const { openEditAgent } = useLayout();
  const nodeId = canManage && agent.ownerEmail ? agent.nodeId : null;
  return (
    <ProfileSection title={t('agents.fieldFolder')}>
      <div className="flex flex-col gap-1.5">
        <div className="font-mono text-xs break-all">{agent.workingDir || '—'}</div>
        {agent.serverHost && <p className={HINT}>{t('agents.workdirDevice', { device: agent.serverHost })}</p>}
        {nodeId ? (
          <>
            <p className={HINT}>{t('agents.workdirEditHint')}</p>
            <div>
              <Button
                variant="outline"
                size="xs"
                onClick={() => openEditAgent({ agentName: agent.agentName, nodeId })}
              >
                <SlidersHorizontal data-icon="inline-start" />
                {t('agents.workdirEdit')}
              </Button>
            </div>
          </>
        ) : !canManage && <p className={HINT}>{t('agents.ownerOnlyHint')}</p>}
      </div>
    </ProfileSection>
  );
}

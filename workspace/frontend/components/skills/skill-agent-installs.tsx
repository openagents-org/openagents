'use client';

import { AlertCircle, Check, Plus } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { Skill } from './skill-types';
import { useSkillInstall, type SkillInstallState } from './use-skill-install';

function InstallAction({
  state,
  error,
  keptPrevious,
  onInstall,
  onUninstall,
}: {
  state: SkillInstallState;
  error?: string;
  keptPrevious?: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const t = useT();
  switch (state) {
    case 'installed':
      // The state and the way to undo it are separate controls, so a label
      // never changes meaning under the pointer.
      return (
        <>
          <Badge variant="secondary">
            <Check data-icon="inline-start" />
            {t('skills.installed')}
          </Badge>
          <Button size="xs" variant="destructive" onClick={onUninstall}>
            {t('common.remove')}
          </Button>
        </>
      );
    case 'installing':
      return (
        <Button size="xs" variant="secondary" disabled>
          <Spinner data-icon="inline-start" />
          {t('skills.installing')}
        </Button>
      );
    case 'incomplete':
      // Installed by an older launcher that only got SKILL.md; reinstalling
      // through a current one either completes it or fails with the reason.
      return (
        <>
          <WithTooltip label={t('skills.incompleteRetryHint')}><Button size="xs" variant="destructive" onClick={onInstall}>
                <AlertCircle data-icon="inline-start" />
                {t('skills.incompleteRetry')}
              </Button></WithTooltip>
          <Button size="xs" variant="ghost" onClick={onUninstall}>
            {t('common.remove')}
          </Button>
        </>
      );
    case 'failed':
      // A failed reinstall keeps the previous install on the agent, so it
      // stays removable alongside the retry.
      return (
        <>
          <WithTooltip label={error ? t('skills.failedRetryReason', { reason: error }) : t('skills.failedRetryHint')}><Button size="xs" variant="destructive" onClick={onInstall}>
                <AlertCircle data-icon="inline-start" />
                {t('skills.failedRetry')}
              </Button></WithTooltip>
          {keptPrevious && (
            <Button size="xs" variant="ghost" onClick={onUninstall}>
              {t('common.remove')}
            </Button>
          )}
        </>
      );
    default:
      return (
        <Button size="xs" onClick={onInstall}>
          <Plus data-icon="inline-start" />
          {t('skills.add')}
        </Button>
      );
  }
}

/** "Add to agent": this skill's state on every online agent that can run it. */
export function SkillAgentInstalls({ skill }: { skill: Skill }) {
  const t = useT();
  const { onlineAgents, stateFor, errorFor, keptPreviousFor, install, uninstall } = useSkillInstall(skill);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('skills.addToAgent')}</CardTitle>
      </CardHeader>
      <CardContent>
        {onlineAgents.length === 0 ? (
          <p className="text-muted-foreground">{t('skills.noOnlineAgents')}</p>
        ) : (
          <ItemGroup className="gap-1.5">
            {onlineAgents.map(agent => {
              const state = stateFor(agent.agentName);
              return (
                <Item
                  key={agent.agentName}
                  variant="outline"
                  size="xs"
                  className={state === 'failed' || state === 'incomplete' ? 'border-destructive/30' : undefined}
                >
                  <ItemMedia>
                    <AgentAvatar name={agent.agentName} size={20} status={agent.status} showStatus />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="truncate">{agentLabel(agent)}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <InstallAction
                      state={state}
                      error={errorFor(agent.agentName)}
                      keptPrevious={keptPreviousFor(agent.agentName)}
                      onInstall={() => install(agent.agentName)}
                      onUninstall={() => uninstall(agent.agentName)}
                    />
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { AlertCircle, Check, Plus } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { Skill } from './skill-types';
import { useSkillInstall, type SkillInstallState } from './use-skill-install';

function InstallAction({
  state,
  onInstall,
  onUninstall,
}: {
  state: SkillInstallState;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const t = useT();
  switch (state) {
    case 'installed':
      // Clicking an installed skill removes it; the hover tint says so.
      return (
        <Button
          size="xs"
          variant="ghost"
          onClick={onUninstall}
          className="bg-success/10 text-success hover:bg-destructive/10 hover:text-destructive"
        >
          <Check data-icon="inline-start" />
          {t('skills.installed')}
        </Button>
      );
    case 'installing':
      return (
        <Button size="xs" variant="secondary" disabled>
          <Spinner data-icon="inline-start" />
          {t('skills.installing')}
        </Button>
      );
    case 'failed':
      return (
        <Button size="xs" variant="destructive" onClick={onInstall} title={t('skills.failedRetryHint')}>
          <AlertCircle data-icon="inline-start" />
          {t('skills.failedRetry')}
        </Button>
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
  const { onlineAgents, stateFor, install, uninstall } = useSkillInstall(skill);

  return (
    <Card size="sm" className="bg-primary/5 ring-primary/20">
      <CardHeader>
        <CardTitle className="text-xs tracking-wider text-primary uppercase">{t('skills.addToAgent')}</CardTitle>
      </CardHeader>
      <CardContent>
        {onlineAgents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('skills.noOnlineAgents')}</p>
        ) : (
          <ItemGroup className="gap-1.5">
            {onlineAgents.map(agent => {
              const state = stateFor(agent.agentName);
              return (
                <Item
                  key={agent.agentName}
                  variant="outline"
                  size="xs"
                  className={state === 'failed' ? 'border-destructive/30 bg-background' : 'bg-background'}
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

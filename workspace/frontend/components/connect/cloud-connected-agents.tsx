'use client';

import { Image as ImageIcon, MessageSquare, Trash2, Volume2 } from 'lucide-react';
import { ProviderIcon } from '@/components/icons/agent-icons';
import { Button } from '@/components/ui/button';
import { FieldSeparator } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { destructiveIconClass } from '@/lib/destructive-icon';
import type { CloudAgentConfig } from '@/lib/types';

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = category === 'image' ? ImageIcon : category === 'audio' ? Volume2 : MessageSquare;
  return <Icon className={cn('text-foreground/70', className)} />;
}

/** Cloud agents this workspace already has, each removable. */
export function ConnectedCloudAgents({ agents, onRemove }: { agents: CloudAgentConfig[]; onRemove: (name: string) => void }) {
  const t = useT();
  if (agents.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <FieldSeparator>{t('connect.connected')}</FieldSeparator>
      <ItemGroup className="gap-2">
        {agents.map((agent) => (
          <Item key={agent.agentName} variant="outline" size="sm" role="listitem">
            <ItemMedia>
              <ProviderIcon name={agent.provider} size={28} />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0.5">
              <ItemTitle>
                @{agent.agentName}
                <CategoryIcon category={agent.category} className="size-3 text-muted-foreground" />
              </ItemTitle>
              <ItemDescription className="text-xs">{agent.model}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <span className="font-mono text-xs text-muted-foreground">{agent.apiKeyMasked}</span>
              <WithTooltip label={t('connect.remove')}><Button
                    variant="ghost"
                    size="icon-sm"
                    className={destructiveIconClass}
                    onClick={() => onRemove(agent.agentName)}
                    aria-label={t('connect.remove')}
                  >
                    <Trash2 />
                  </Button></WithTooltip>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}

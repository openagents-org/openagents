'use client';

import { MessageSquarePlus, User } from 'lucide-react';
import { agentLabel } from '@/lib/helpers';
import { humanColor } from '@/lib/human-color';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NewDmMenuProps {
  agents: WorkspaceAgent[];
  people: { email: string; name: string }[];
  onStart: (address: string) => void;
}

/** "New DM" picker above the DMs tab: online agents, then people. */
export function NewDmMenu({ agents, people, onStart }: NewDmMenuProps) {
  const t = useT();
  const onlineAgents = agents.filter((a) => a.status === 'online');
  return (
    <div className="flex px-1 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <MessageSquarePlus data-icon="inline-start" />
            {t('threads.newDm')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
          {onlineAgents.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('threads.dmAgents')}</DropdownMenuLabel>
              {onlineAgents.map((a) => (
                <DropdownMenuItem key={a.agentName} onClick={() => onStart(`openagents:${a.agentName}`)}>
                  <AgentAvatar name={a.agentName} size={16} />
                  {agentLabel(a)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
          {people.length > 0 && (
            <>
              {onlineAgents.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('threads.dmPeople')}</DropdownMenuLabel>
                {people.map((p) => (
                  <DropdownMenuItem key={p.email} onClick={() => onStart(`human:${p.email}`)} title={p.email}>
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: humanColor(p.email) }}
                    >
                      <User className="size-2.5 text-foreground" />
                    </span>
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
          {onlineAgents.length === 0 && people.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">{t('threads.noDmCandidates')}</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

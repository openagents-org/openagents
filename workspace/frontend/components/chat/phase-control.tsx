'use client';

import * as React from 'react';
import { ClipboardCheck, Hammer, Check, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { WorkspaceSession, WorkspaceAgent } from '@/lib/types';

type Phase = 'open' | 'clarifying' | 'building';

interface Props {
  session: WorkspaceSession;
  agents: WorkspaceAgent[];
  onChange: (updates: { phase?: Phase; phaseOwner?: string | null }) => void;
}

/**
 * Header control for the requirement-clarification gate.
 *
 * While a thread is `clarifying`, the backend keeps routing with the phase
 * owner: no other agent can be handed the floor on topic match, and one that
 * is explicitly @mentioned answers in plan mode instead of starting to build.
 * This is the release valve — the user says when the requirement is settled.
 *
 * Off ('open') by default, so a thread only behaves this way once someone
 * asks it to.
 */
export function PhaseControl({ session, agents, onChange }: Props) {
  const phase = (session.phase || 'open') as Phase;
  const owner = session.phaseOwner || session.master || null;

  if (phase === 'clarifying') {
    return (
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 text-xs font-medium text-amber-600 dark:text-amber-500"
              title="The requirement is still being clarified — other agents can be consulted but cannot start building"
            >
              <ClipboardCheck className="size-3.5" />
              <span className="hidden lg:inline">
                Clarifying{owner ? ` · @${owner}` : ''}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Clarification owner</DropdownMenuLabel>
            <p className="px-2 pb-1.5 text-[11px] text-muted-foreground leading-snug">
              This agent holds the floor. Others can be @mentioned for input, but they
              answer in plan mode and cannot start implementing.
            </p>
            <DropdownMenuSeparator />
            {agents.map((a) => (
              <DropdownMenuItem
                key={a.agentName}
                onSelect={(e) => {
                  e.preventDefault();
                  onChange({ phaseOwner: a.agentName });
                }}
                className="flex items-center gap-2 py-1.5 text-xs cursor-pointer"
              >
                <span className="font-medium">@{a.agentName}</span>
                {a.role === 'master' && <Crown className="size-3 text-amber-500" />}
                {a.agentName === owner && <Check className="size-3 text-primary ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onChange({ phase: 'open' });
              }}
              className="text-xs cursor-pointer"
            >
              Turn the gate off
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange({ phase: 'building' })}
          className="gap-1.5 h-7 text-xs font-medium"
          title="Release the gate — agents may start implementing"
        >
          <Hammer className="size-3.5" />
          <span className="hidden lg:inline">Requirement confirmed</span>
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onChange({ phase: 'clarifying' })}
      className={cn(
        'gap-1.5 h-7 text-xs font-medium',
        phase === 'building' && 'text-muted-foreground',
      )}
      title="Hold the thread in clarification: only the owner keeps the floor until you confirm the requirement"
    >
      <ClipboardCheck className="size-3.5" />
      <span className="hidden lg:inline">
        {phase === 'building' ? 'Building' : 'Clarify first'}
      </span>
    </Button>
  );
}

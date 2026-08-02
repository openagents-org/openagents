'use client';

import * as React from 'react';
import { ClipboardCheck, Hammer, Check, Crown, AlertTriangle } from 'lucide-react';
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
 * Turning the gate ON always names an owner in the same request. Threads
 * created from the agent picker deliberately have no master, so a bare
 * `phase: 'clarifying'` would leave the backend with nobody to hold the
 * floor: it rejects that, and this control would otherwise have shown
 * "Clarifying" over routing that never changed.
 *
 * Off ('open') by default, so a thread only behaves this way once someone
 * asks it to.
 */
export function PhaseControl({ session, agents, onChange }: Props) {
  const phase = (session.phase || 'open') as Phase;
  const owner = session.phaseOwner || session.master || null;

  const ownerMenu = (label: string) => (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
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
            // Phase and owner travel together: the backend refuses a gate
            // with nobody able to hold it.
            onChange({ phase: 'clarifying', phaseOwner: a.agentName });
          }}
          className="flex items-center gap-2 py-1.5 text-xs cursor-pointer"
        >
          <span className="font-medium">@{a.agentName}</span>
          {a.role === 'master' && <Crown className="size-3 text-amber-500" />}
          {a.agentName === owner && <Check className="size-3 text-primary ml-auto" />}
        </DropdownMenuItem>
      ))}
    </>
  );

  if (phase === 'clarifying') {
    // Legacy rows written before the owner became mandatory, or an owner that
    // was removed between renders. Say so instead of implying a gate that
    // isn't being enforced.
    const ownerless = !owner;
    return (
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'gap-1.5 h-7 text-xs font-medium',
                ownerless
                  ? 'text-destructive'
                  : 'text-amber-600 dark:text-amber-500',
              )}
              title={
                ownerless
                  ? 'No agent owns this clarification, so nothing is being held back — pick an owner'
                  : 'The requirement is still being clarified — other agents can be consulted but cannot start building'
              }
            >
              {ownerless ? (
                <AlertTriangle className="size-3.5" />
              ) : (
                <ClipboardCheck className="size-3.5" />
              )}
              <span className="hidden lg:inline">
                {ownerless ? 'Clarifying · needs an owner' : `Clarifying · @${owner}`}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {ownerMenu('Clarification owner')}
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {ownerMenu('Clarify first — who owns the requirement?')}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

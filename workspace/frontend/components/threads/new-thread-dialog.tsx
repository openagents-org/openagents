'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { History, Check, Minus } from 'lucide-react';
import type { WorkspaceAgent, WorkspaceSession } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  sessions?: WorkspaceSession[];
  onCreateThread: (opts: { participants: string[]; resumeFrom?: string }) => void;
}

export function NewThreadDialog({ open, onOpenChange, agents, sessions, onCreateThread }: NewThreadDialogProps) {
  // Only show online agents in the picker
  const onlineAgents = agents.filter((a) => a.status === 'online');
  const offlineAgentCount = agents.length - onlineAgents.length;
  const agentNames = onlineAgents.map((a) => a.agentName);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resumeFrom, setResumeFrom] = useState<string>('');

  const isAllSelected = onlineAgents.length > 0 && selected.size === onlineAgents.length;
  const isPartiallySelected = selected.size > 0 && selected.size < onlineAgents.length;

  const toggleAll = () => {
    setSelected(isAllSelected ? new Set() : new Set(agentNames));
  };

  // Reset state when dialog opens. When there's exactly one online agent,
  // pre-select it so the common single-agent case is a one-click "Start Thread".
  useEffect(() => {
    if (open) {
      setSelected(onlineAgents.length === 1 ? new Set([onlineAgents[0].agentName]) : new Set());
      setResumeFrom('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAgent = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleCreate = () => {
    // No leader is assigned at creation — the default "dynamic" mode doesn't
    // need one. A leader can be set later from the thread's agent menu (and is
    // only required by "master" orchestration mode).
    const participants = agentNames.filter((n) => selected.has(n));
    onCreateThread({ participants, resumeFrom: resumeFrom || undefined });
    onOpenChange(false);
  };

  // Filter sessions that have messages (lastEventAt != null) for resume picker
  const resumableSessions = (sessions || []).filter(
    (s) => s.status === 'active' && s.lastEventAt != null
  );

  // Check if any selected agent is a Claude Code agent (heuristic: agent type or name contains 'claude')
  const hasClaudeAgent = onlineAgents.some(
    (a) => selected.has(a.agentName) && /claude/i.test(a.agentName)
  );

  const multipleAgents = onlineAgents.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>New Thread</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {multipleAgents
            ? 'Pick which agents join this conversation.'
            : 'Start a new conversation with your agent.'}
        </DialogDescription>

        {/* Select All Control */}
        {onlineAgents.length > 0 && (
          <button
            type="button"
            className="mt-3 flex w-full items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
            onClick={toggleAll}
          >
            <div className={cn(
              'size-4 rounded shrink-0 flex items-center justify-center border transition-colors',
              isAllSelected || isPartiallySelected
                ? 'bg-blue-500 border-blue-500 text-white'
                : 'border-zinc-300 dark:border-zinc-600'
            )}>
              {isAllSelected && <Check className="size-3" strokeWidth={3} />}
              {isPartiallySelected && <Minus className="size-3" strokeWidth={3} />}
            </div>
            <span className="text-sm font-medium">
              {isAllSelected
                ? 'All agents selected'
                : isPartiallySelected
                  ? `${selected.size} of ${onlineAgents.length} agents selected`
                  : 'Select all agents'}
            </span>
          </button>
        )}
        {offlineAgentCount > 0 && (
          <p className={cn(
            'px-3 text-[11px] text-muted-foreground/70',
            onlineAgents.length > 0 ? 'mt-1' : 'mt-3'
          )}>
            {offlineAgentCount} offline {offlineAgentCount === 1 ? 'agent' : 'agents'} not included
          </p>
        )}

        {/* Agent list */}
        <div className={cn(
          'space-y-1.5 max-h-64 overflow-y-auto',
          onlineAgents.length === 0 ? 'mt-3' : 'mt-1.5'
        )}>
          {onlineAgents.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No agents are currently online.</p>
          )}
          {onlineAgents.map((agent) => {
            const isSelected = selected.has(agent.agentName);

            return (
              <div
                key={agent.agentName}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all border',
                  isSelected
                    ? 'bg-zinc-50 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700'
                    : 'border-transparent opacity-50 hover:opacity-75 hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                )}
                onClick={() => toggleAgent(agent.agentName)}
              >
                {/* Checkbox */}
                <div className={cn(
                  'size-4 rounded shrink-0 flex items-center justify-center border transition-colors',
                  isSelected
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'border-zinc-300 dark:border-zinc-600'
                )}>
                  {isSelected && <Check className="size-3" strokeWidth={3} />}
                </div>

                {/* Avatar */}
                <AgentAvatar name={agent.agentName} size={24} />

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate">{agent.agentName}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Resume from past session — show when there are resumable sessions */}
        {hasClaudeAgent && resumableSessions.length > 0 && (
          <div className="mt-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
              <History className="size-3" />
              Resume from past session
            </label>
            <select
              value={resumeFrom}
              onChange={(e) => setResumeFrom(e.target.value)}
              className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">New conversation (no context)</option>
              {resumableSessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.title || s.sessionId}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={selected.size === 0}>
            {resumeFrom ? 'Resume Thread' : 'Start Thread'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

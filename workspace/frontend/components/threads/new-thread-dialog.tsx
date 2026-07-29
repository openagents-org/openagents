'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { History, Check, Minus, Users } from 'lucide-react';
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
      {/* Sized to match the confirm dialog's roomier spacing — this one carries a
          scrolling agent list, so it goes a step wider again. */}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="space-y-3 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">New Thread</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {multipleAgents
              ? 'Pick which agents join this conversation.'
              : 'Start a new conversation with your agent.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 px-7 py-2">
          {/* Select All Control */}
          {onlineAgents.length > 0 && (
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3.5 py-2.5 rounded-md cursor-pointer text-left transition-colors hover:bg-muted/60"
              onClick={toggleAll}
            >
              <div className={cn(
                'size-4 rounded-sm shrink-0 flex items-center justify-center border transition-colors',
                isAllSelected || isPartiallySelected
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-input'
              )}>
                {isAllSelected && <Check className="size-3" strokeWidth={3} />}
                {isPartiallySelected && <Minus className="size-3" strokeWidth={3} />}
              </div>
              <span className="text-[15px] font-medium">
                {isAllSelected
                  ? 'All agents selected'
                  : isPartiallySelected
                    ? `${selected.size} of ${onlineAgents.length} agents selected`
                    : 'Select all agents'}
              </span>
            </button>
          )}
          {offlineAgentCount > 0 && (
            <p className="px-3 text-[11px] text-muted-foreground/70">
              {offlineAgentCount} offline {offlineAgentCount === 1 ? 'agent' : 'agents'} not included
            </p>
          )}

          {/* Agent list */}
          {onlineAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Users className="size-5" />
              </div>
              <p className="text-sm text-muted-foreground">No agents are currently online.</p>
            </div>
          ) : (
            /* No scroll container of its own: DialogBody is the single scroll
               region (pinned header/footer, hidden scrollbar). A nested
               overflow-y here would give a long agent list a second, visible
               scrollbar inside a box that is already scrollable. */
            <div className="space-y-1.5">
              {onlineAgents.map((agent) => {
                const isSelected = selected.has(agent.agentName);

                return (
                  <div
                    key={agent.agentName}
                    className={cn(
                      'flex items-center gap-3 px-3.5 py-3 rounded-md cursor-pointer transition-all border',
                      isSelected
                        ? 'bg-muted/50 border-border'
                        : 'border-transparent opacity-60 hover:opacity-100 hover:bg-muted/40'
                    )}
                    onClick={() => toggleAgent(agent.agentName)}
                  >
                    {/* Checkbox */}
                    <div className={cn(
                      'size-4 rounded-sm shrink-0 flex items-center justify-center border transition-colors',
                      isSelected
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-input'
                    )}>
                      {isSelected && <Check className="size-3" strokeWidth={3} />}
                    </div>

                    {/* Avatar */}
                    <AgentAvatar name={agent.agentName} size={28} />

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[15px] font-medium truncate">{agent.agentName}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Resume from past session — show when there are resumable sessions */}
          {hasClaudeAgent && resumableSessions.length > 0 && (
            <div className="pt-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <History className="size-3" />
                Resume from past session
              </label>
              <select
                value={resumeFrom}
                onChange={(e) => setResumeFrom(e.target.value)}
                className="w-full h-10 text-sm rounded-md border border-input bg-background px-3 shadow-xs shadow-black/5 transition-[color,box-shadow] focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
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
        </DialogBody>

        <DialogFooter className="px-7 pt-7 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="min-w-24" onClick={handleCreate} disabled={selected.size === 0}>
            {resumeFrom ? 'Resume Thread' : 'Start Thread'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

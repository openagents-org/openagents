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
import { History, Check, Star, User } from 'lucide-react';
import type { WorkspaceAgent, WorkspaceCollaborator, WorkspaceSession } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentPresence } from '@/lib/helpers';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  humans?: WorkspaceCollaborator[];
  sessions?: WorkspaceSession[];
  onCreateThread: (opts: { master: string; participants: string[]; humanParticipants: string[]; resumeFrom?: string }) => void;
}

export function NewThreadDialog({ open, onOpenChange, agents, humans, sessions, onCreateThread }: NewThreadDialogProps) {
  const { user: googleUser } = useOpenAgentsAuth();
  // Only show online agents in the picker
  const onlineAgents = agents.filter((a) => a.status === 'online');
  const agentNames = onlineAgents.map((a) => a.agentName);
  const defaultMaster = onlineAgents.find((a) => a.role === 'master')?.agentName || onlineAgents[0]?.agentName || '';
  // Exclude the signed-in user from the People picker — they're the
  // implicit creator of the chat, so picking themselves is meaningless.
  const selfEmail = googleUser?.email?.trim().toLowerCase();
  const humanList = (humans || []).filter((h) => h.email.toLowerCase() !== selfEmail);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedHumans, setSelectedHumans] = useState<Set<string>>(new Set());
  const [master, setMaster] = useState('');
  const [resumeFrom, setResumeFrom] = useState<string>('');

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSelectedHumans(new Set());
      setMaster('');
      setResumeFrom('');
    }
  }, [open]);

  const toggleHuman = (email: string) => {
    setSelectedHumans((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const toggleAgent = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        if (name === master) {
          // Deselecting the lead — pick another selected agent as lead, or clear
          next.delete(name);
          const remaining = Array.from(next);
          setMaster(remaining.length > 0 ? remaining[0] : '');
        } else {
          next.delete(name);
        }
      } else {
        next.add(name);
        // First agent selected becomes the lead automatically
        if (next.size === 1 || !master) {
          setMaster(name);
        }
      }
      return next;
    });
  };

  const setAsMaster = (name: string) => {
    setMaster(name);
    // Ensure master is selected
    setSelected((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  };

  const handleCreate = () => {
    const participants = agentNames.filter((n) => selected.has(n));
    const humanParticipants = Array.from(selectedHumans);
    onCreateThread({ master, participants, humanParticipants, resumeFrom: resumeFrom || undefined });
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
        <DialogTitle>New Chat</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {multipleAgents
            ? 'Pick which agents join this conversation.'
            : 'Start a new conversation with your agent.'}
        </DialogDescription>

        {/* Agent list */}
        <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
          {onlineAgents.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {agentPresence(agents) === 'offline'
                ? 'No agents are currently online.'
                : 'Connect an agent to start chatting.'}
            </p>
          )}
          {onlineAgents.map((agent) => {
            const isSelected = selected.has(agent.agentName);
            const isMaster = agent.agentName === master;

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

                {/* Lead badge / set-as-lead button — only show when multiple agents */}
                {multipleAgents && isSelected && (
                  isMaster ? (
                    <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium shrink-0">
                      <Star className="size-3 fill-current" />
                      lead
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAsMaster(agent.agentName); }}
                      className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
                    >
                      set lead
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>

        {/* Lead explanation — only when multiple agents are selected */}
        {multipleAgents && selected.size > 1 && (
          <p className="text-[11px] text-muted-foreground/70 mt-2 px-1">
            The <Star className="size-2.5 inline fill-amber-500 text-amber-500 -mt-px" /> lead agent coordinates the others and responds to your messages first.
          </p>
        )}

        {/* Humans — added to channel_human_members on the backend so they
            get a push for every message in this chat, not just @mentions. */}
        {humanList.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5 px-1">People</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {humanList.map((h) => {
                const isSelected = selectedHumans.has(h.email);
                return (
                  <div
                    key={h.email}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all border',
                      isSelected
                        ? 'bg-zinc-50 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700'
                        : 'border-transparent opacity-50 hover:opacity-75 hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                    )}
                    onClick={() => toggleHuman(h.email)}
                  >
                    <div className={cn(
                      'size-4 rounded shrink-0 flex items-center justify-center border transition-colors',
                      isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'border-zinc-300 dark:border-zinc-600'
                    )}>
                      {isSelected && <Check className="size-3" strokeWidth={3} />}
                    </div>
                    <div className="size-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center shrink-0">
                      <User className="size-3.5 text-zinc-600 dark:text-zinc-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{h.displayName || h.email}</span>
                      {h.displayName && (
                        <span className="text-[11px] text-muted-foreground truncate block">{h.email}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
          <Button size="sm" onClick={handleCreate} disabled={selected.size === 0 && selectedHumans.size === 0}>
            {resumeFrom ? 'Resume Chat' : 'Start Chat'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

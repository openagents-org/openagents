'use client';

import { useState, useEffect } from 'react';
import { useT } from '@/lib/i18n';
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
import { History, Check, Minus, Users, ClipboardCheck } from 'lucide-react';
import type { WorkspaceAgent, WorkspaceSession } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Stands in for "start fresh" in the resume picker. Radix rejects an empty
 * string as an item value — it reserves that for "nothing selected" — so the
 * no-context choice needs a value of its own, unwrapped again on submit.
 */
const NO_RESUME = 'none';

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  sessions?: WorkspaceSession[];
  onCreateThread: (opts: {
    participants: string[];
    resumeFrom?: string;
    phase?: string;
    phaseOwner?: string;
  }) => void;
}

/**
 * Who should own the clarification phase for a set of selected agents.
 *
 * The workspace master is the only coordinator signal the system actually
 * has, so it is preselected when it is among the participants. Otherwise the
 * user picks: guessing would often land on the agent that builds things, and
 * a gate whose owner is the builder is no gate at all.
 */
function defaultClarifyOwner(agents: WorkspaceAgent[], selected: Set<string>): string {
  const master = agents.find((a) => selected.has(a.agentName) && a.role === 'master');
  return master ? master.agentName : '';
}

export function NewThreadDialog({ open, onOpenChange, agents, sessions, onCreateThread }: NewThreadDialogProps) {
  const t = useT();
  // Only show online agents in the picker
  const onlineAgents = agents.filter((a) => a.status === 'online');
  const offlineAgentCount = agents.length - onlineAgents.length;
  const agentNames = onlineAgents.map((a) => a.agentName);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resumeFrom, setResumeFrom] = useState<string>(NO_RESUME);
  // Multi-agent threads start in clarification by default: without it the
  // router hands the first underspecified request straight to whichever agent
  // matches the topic, which is how an RD agent ends up writing code before
  // the requirement exists.
  const [clarifyFirst, setClarifyFirst] = useState(true);
  const [clarifyOwner, setClarifyOwner] = useState<string>('');

  const isAllSelected = onlineAgents.length > 0 && selected.size === onlineAgents.length;
  const isPartiallySelected = selected.size > 0 && selected.size < onlineAgents.length;

  const toggleAll = () => {
    setSelected(isAllSelected ? new Set() : new Set(agentNames));
  };

  // Reset state when dialog opens. When there's exactly one online agent,
  // pre-select it so the common single-agent case is a one-click "Start Thread".
  useEffect(() => {
    if (open) {
      const initial = onlineAgents.length === 1
        ? new Set([onlineAgents[0].agentName])
        : new Set<string>();
      setSelected(initial);
      setResumeFrom(NO_RESUME);
      setClarifyFirst(true);
      setClarifyOwner(defaultClarifyOwner(onlineAgents, initial));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // The agents that would actually join: `selected` can name an agent that
  // has since gone offline, and `handleCreate` filters participants against
  // the CURRENT online list. Everything the gate decides — whether to offer
  // it, who may own it, whether the owner is still valid — has to be derived
  // from this same set, or the dialog offers a gate whose owner it then omits
  // from the participants it submits.
  const selectedOnline = agentNames.filter((n) => selected.has(n));
  const selectedOnlineKey = selectedOnline.join(',');

  // Re-derive the owner whenever that set changes — deselecting the chosen
  // owner, or discovery reporting it offline, must not leave a stale name
  // behind for submit.
  useEffect(() => {
    const live = new Set(selectedOnline);
    setClarifyOwner((prev) =>
      prev && live.has(prev) ? prev : defaultClarifyOwner(onlineAgents, live)
    );
  }, [selectedOnlineKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // A gate only means anything once two agents can compete for the floor.
  const showClarifyOption = selectedOnline.length >= 2;
  // Checked but no valid owner: the thread would be created gated-but-unowned
  // (plan-only for everyone), so block here instead of shipping that state.
  const needsOwner =
    showClarifyOption && clarifyFirst && !selectedOnline.includes(clarifyOwner);

  const handleCreate = () => {
    // No leader is assigned at creation — the default "dynamic" mode doesn't
    // need one. A leader can be set later from the thread's agent menu (and is
    // only required by "master" orchestration mode).
    const participants = selectedOnline;
    // The phase travels with the create event rather than a PATCH afterwards:
    // a thread that is ungated for even a moment can have its first message
    // routed to a builder before the gate lands.
    const gated = showClarifyOption && clarifyFirst && !!clarifyOwner;
    onCreateThread({
      participants,
      resumeFrom: resumeFrom === NO_RESUME ? undefined : resumeFrom,
      ...(gated && { phase: 'clarifying', phaseOwner: clarifyOwner }),
    });
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
          <DialogTitle className="text-xl">{t('newThread.title')}</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {multipleAgents
              ? t('newThread.descriptionMulti')
              : t('newThread.descriptionSingle')}
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
                  ? t('newThread.allSelected')
                  : isPartiallySelected
                    ? t('newThread.partialSelected', { selected: selected.size, total: onlineAgents.length })
                    : t('newThread.selectAll')}
              </span>
            </button>
          )}
          {offlineAgentCount > 0 && (
            <p className="px-3 text-[11px] text-muted-foreground/70">
              {t('newThread.offlineExcluded', { count: offlineAgentCount })}
            </p>
          )}

          {/* Agent list */}
          {onlineAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Users className="size-5" />
              </div>
              <p className="text-sm text-muted-foreground">{t('newThread.noneOnline')}</p>
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

          {/* Clarify-first gate — multi-agent threads only */}
          {showClarifyOption && (
            <div className="pt-1 space-y-2">
              <button
                type="button"
                className="flex w-full items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer text-left transition-colors hover:bg-muted/60"
                onClick={() => setClarifyFirst((v) => !v)}
              >
                <div className={cn(
                  'size-4 mt-0.5 rounded-sm shrink-0 flex items-center justify-center border transition-colors',
                  clarifyFirst
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'border-input'
                )}>
                  {clarifyFirst && <Check className="size-3" strokeWidth={3} />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <ClipboardCheck className="size-3.5" />
                    {t('newThread.clarifyLabel')}
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {t('newThread.clarifyHint')}
                  </p>
                </div>
              </button>

              {clarifyFirst && (
                <div className="px-3">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    {t('newThread.clarifyOwnerLabel')}
                  </label>
                  <Select value={clarifyOwner} onValueChange={setClarifyOwner}>
                    <SelectTrigger
                      className={cn('w-full h-8.5', needsOwner && 'border-destructive')}
                    >
                      <SelectValue placeholder={t('newThread.clarifyOwnerPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {onlineAgents
                          .filter((a) => selectedOnline.includes(a.agentName))
                          .map((a) => (
                            <SelectItem key={a.agentName} value={a.agentName}>
                              {a.role === 'master'
                                ? t('newThread.clarifyOwnerMaster', { name: a.agentName })
                                : a.agentName}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {needsOwner && (
                    <p className="text-[11px] text-destructive mt-1">
                      {t('newThread.clarifyOwnerRequired')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Resume from past session — show when there are resumable sessions */}
          {hasClaudeAgent && resumableSessions.length > 0 && (
            <div className="pt-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <History className="size-3" />
                {t('newThread.resumeLabel')}
              </label>
              <Select value={resumeFrom} onValueChange={setResumeFrom}>
                <SelectTrigger className="w-full h-8.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_RESUME}>{t('newThread.resumeNone')}</SelectItem>
                    {resumableSessions.map((s) => (
                      <SelectItem key={s.sessionId} value={s.sessionId}>
                        {s.title || s.sessionId}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="px-7 pt-7 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            className="min-w-24"
            onClick={handleCreate}
            disabled={selected.size === 0 || needsOwner}
          >
            {resumeFrom !== NO_RESUME ? t('newThread.resume') : t('newThread.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

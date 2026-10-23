'use client';

import { isIssueWorkSession } from '@/lib/conversation-list';

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
import { History, Lock, Globe } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { TeamMember, WorkspaceAgent, WorkspaceSession } from '@/lib/types';
import { ParticipantPicker, type ParticipantOption } from './participant-picker';
import type { ThreadVisibility } from '@/lib/access-ui';
import { agentLabel } from '@/lib/helpers';
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
  teammates?: TeamMember[];
  /** Start with "Make it a channel" switched on (opened from a New channel button). */
  defaultAsChannel?: boolean;
  onCreateThread: (opts: { participants: string[]; humanParticipants: string[]; resumeFrom?: string; visibility: ThreadVisibility; asChannel: boolean }) => Promise<void>;
}

export function NewThreadDialog({ open, onOpenChange, agents, sessions, teammates = [], defaultAsChannel = false, onCreateThread }: NewThreadDialogProps) {
  const t = useT();
  // Only show online agents in the picker
  const availableAgents = agents.filter(a => a.canStartThread !== false);
  const onlineAgents = availableAgents.filter((a) => a.status === 'online');
  const offlineAgentCount = availableAgents.length - onlineAgents.length;
  // "Select all" covers the user's own agents. The built-in assistant (Yumi)
  // is only ever added to a thread when picked deliberately, so it stays out
  // of the bulk toggle (it remains individually selectable).
  const agentNames = onlineAgents.map((a) => a.agentName);
  const bulkNames = onlineAgents.filter((a) => !a.builtin).map((a) => a.agentName);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resumeFrom, setResumeFrom] = useState<string>(NO_RESUME);
  // v1.1 permission model: threads are private by default; Public is opt-in.
  const [visibility, setVisibility] = useState<ThreadVisibility>('private');
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());
  const [asChannel, setAsChannel] = useState(defaultAsChannel);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAllSelected = bulkNames.length > 0 && bulkNames.every((n) => selected.has(n));
  const candidates: ParticipantOption[] = [
    ...teammates.map((person) => ({
      kind: 'human' as const, id: person.email,
      label: person.displayName || person.email, detail: person.displayName ? person.email : '',
    })),
    ...onlineAgents.map((agent) => ({
      kind: 'agent' as const, id: agent.agentName,
      label: agentLabel(agent), detail: t('newThread.agent'),
    })),
  ];
  const picks = candidates.filter((p) => p.kind === 'human' ? selectedPeople.has(p.id) : selected.has(p.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const current = Array.from(prev);
      if (isAllSelected) return new Set(current.filter((n) => !bulkNames.includes(n)));
      return new Set(current.concat(bulkNames));
    });
  };

  // Reset state when dialog opens. When there's exactly one online agent,
  // pre-select it so the common single-agent case is a one-click "Start Thread".
  useEffect(() => {
    if (open) {
      setSelected(onlineAgents.length === 1 ? new Set([onlineAgents[0].agentName]) : new Set());
      setResumeFrom(NO_RESUME);
      setVisibility('private');
      setSelectedPeople(new Set());
      setAsChannel(defaultAsChannel);
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreateThread({
        participants: agentNames.filter((n) => selected.has(n)),
        humanParticipants: teammates.filter((p) => selectedPeople.has(p.email)).map((p) => p.email),
        resumeFrom: hasClaudeAgent && resumeFrom !== NO_RESUME ? resumeFrom : undefined,
        visibility,
        asChannel,
      });
      onOpenChange(false);
    } catch {
      setError(t('newThread.createError'));
    } finally {
      setCreating(false);
    }
  };

  // Filter sessions that have messages (lastEventAt != null) for resume picker
  const resumableSessions = (sessions || []).filter(
    (s) => !isIssueWorkSession(s) && s.status === 'active' && s.lastEventAt != null
  );

  // Check if any selected agent is a Claude Code agent (heuristic: agent type or name contains 'claude')
  const hasClaudeAgent = onlineAgents.some(
    (a) => selected.has(a.agentName) && /claude/i.test(a.agentName)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sized to match the confirm dialog's roomier spacing — this one carries a
          scrolling agent list, so it goes a step wider again. */}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="space-y-2 px-6 pt-6 pb-2">
          <DialogTitle className="text-xl">{t(asChannel ? 'newThread.channelTitle' : 'newThread.title')}</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {t('newThread.descriptionMulti')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 px-6 py-2">
          <ParticipantPicker options={candidates} value={picks} disabled={creating}
            onChange={(next) => {
              setSelectedPeople(new Set(next.filter((p) => p.kind === 'human').map((p) => p.id)));
              setSelected(new Set(next.filter((p) => p.kind === 'agent').map((p) => p.id)));
            }}
            onToggleAllAgents={bulkNames.length ? toggleAll : undefined} allAgentsSelected={isAllSelected} />
          {offlineAgentCount > 0 && <p className="text-[11px] text-muted-foreground/70">
            {t('newThread.offlineExcluded', { count: offlineAgentCount })}
          </p>}

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

          {/* v1.1 permission model: who can see the thread. Private by default;
              Public = everyone in the workspace can see and join. */}
          <div className="space-y-1.5 pt-1">
            <p className="px-1 text-xs font-medium text-muted-foreground">{t('threadAccess.newThreadVisibility')}</p>
            <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup">
              {(['private', 'public'] as const).map((v) => {
                const active = visibility === v;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setVisibility(v)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
                      active ? 'border-border bg-muted/50' : 'border-transparent opacity-70 hover:opacity-100 hover:bg-muted/40',
                    )}
                  >
                    {v === 'private'
                      ? <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      : <Globe className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {v === 'private' ? t('threadAccess.private') : t('threadAccess.public')}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {v === 'private' ? t('threadAccess.newThreadPrivateHint') : t('threadAccess.newThreadPublicHint')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* A channel is a long-running thread, pinned under the Channels tab. */}
          <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t('newThread.asChannel')}</span>
              <span className="block text-xs text-muted-foreground">{t('newThread.asChannelHint')}</span>
            </span>
            <Switch checked={asChannel} disabled={creating} onCheckedChange={setAsChannel} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogBody>

        <DialogFooter className="px-6 pt-3 pb-6 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleCreate} disabled={creating || (selected.size === 0 && selectedPeople.size === 0)}>
            {hasClaudeAgent && resumeFrom !== NO_RESUME ? t('newThread.resume') : t(asChannel ? 'newThread.startChannel' : 'newThread.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

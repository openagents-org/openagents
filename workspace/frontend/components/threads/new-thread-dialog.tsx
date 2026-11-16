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
import { Input } from '@/components/ui/input';
import { AlertCircle, History, Lock, Globe } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
/** Matches the length an auto-generated title is cut to. */
const TITLE_MAX_LENGTH = 60;

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  sessions?: WorkspaceSession[];
  teammates?: TeamMember[];
  /** Start with "Make it a channel" switched on (opened from a New channel button). */
  defaultAsChannel?: boolean;
  onCreateThread: (opts: { title?: string; participants: string[]; humanParticipants: string[]; resumeFrom?: string; visibility: ThreadVisibility; asChannel: boolean }) => Promise<void>;
}

export function NewThreadDialog({ open, onOpenChange, agents, sessions, teammates = [], defaultAsChannel = false, onCreateThread }: NewThreadDialogProps) {
  const t = useT();
  // Only show online agents in the picker
  const availableAgents = agents.filter(a => !a.builtin && a.canStartThread !== false);
  const onlineAgents = availableAgents.filter((a) => a.status === 'online');
  const offlineAgentCount = availableAgents.length - onlineAgents.length;
  // Personal assistants are only available through direct conversations.
  const agentNames = onlineAgents.map((a) => a.agentName);
  const bulkNames = onlineAgents.filter((a) => !a.builtin).map((a) => a.agentName);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resumeFrom, setResumeFrom] = useState<string>(NO_RESUME);
  // v1.1 permission model: threads are private by default; Public is opt-in.
  const [visibility, setVisibility] = useState<ThreadVisibility>('private');
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());
  const [asChannel, setAsChannel] = useState(defaultAsChannel);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCreate = !creating && (selected.size > 0 || selectedPeople.size > 0);

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
      setTitle('');
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreateThread({
        title: title.trim() || undefined,
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
        <DialogHeader>
          <DialogTitle className="text-xl">{t(asChannel ? 'newThread.channelTitle' : 'newThread.title')}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t('newThread.descriptionMulti')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          <ParticipantPicker options={candidates} value={picks} disabled={creating}
            onChange={(next) => {
              setSelectedPeople(new Set(next.filter((p) => p.kind === 'human').map((p) => p.id)));
              setSelected(new Set(next.filter((p) => p.kind === 'agent').map((p) => p.id)));
            }}
            onToggleAllAgents={bulkNames.length ? toggleAll : undefined} allAgentsSelected={isAllSelected} />
          {offlineAgentCount > 0 && <p className="text-xs text-muted-foreground/70">
            {t('newThread.offlineExcluded', { count: offlineAgentCount })}
          </p>}

          {/* Optional: named up front, the thread keeps this title; left blank,
              it is still titled from its first message as before. */}
          <Field className="pt-1">
            <FieldLabel htmlFor="new-thread-title">{t('newThread.titleLabel')}</FieldLabel>
            <Input
              id="new-thread-title"
              value={title}
              maxLength={TITLE_MAX_LENGTH}
              disabled={creating}
              placeholder={t('newThread.titlePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && canCreate) {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
            />
          </Field>

          {/* Resume from past session — show when there are resumable sessions */}
          {hasClaudeAgent && resumableSessions.length > 0 && (
            <Field className="pt-1">
              <FieldLabel htmlFor="new-thread-resume">
                <History className="size-3.5" />
                {t('newThread.resumeLabel')}
              </FieldLabel>
              <Select value={resumeFrom} onValueChange={setResumeFrom}>
                <SelectTrigger id="new-thread-resume" className="w-full">
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
            </Field>
          )}

          {/* v1.1 permission model: who can see the thread. Private by default;
              Public = everyone in the workspace can see and join. */}
          <FieldSet className="gap-0 pt-1">
            <FieldLegend variant="label">{t('threadAccess.newThreadVisibility')}</FieldLegend>
            {/* Choice cards: the whole card picks the radio inside it. */}
            <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as ThreadVisibility)}
              className="grid gap-1.5 sm:grid-cols-2">
              {(['private', 'public'] as const).map((v) => (
                <FieldLabel key={v} htmlFor={`new-thread-visibility-${v}`}>
                  <Field orientation="horizontal">
                    <RadioGroupItem value={v} id={`new-thread-visibility-${v}`} />
                    <FieldContent>
                      <FieldTitle>
                        {v === 'private' ? <Lock className="size-3.5 text-muted-foreground" /> : <Globe className="size-3.5 text-muted-foreground" />}
                        {v === 'private' ? t('threadAccess.private') : t('threadAccess.public')}
                      </FieldTitle>
                      <FieldDescription>
                        {v === 'private' ? t('threadAccess.newThreadPrivateHint') : t('threadAccess.newThreadPublicHint')}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          </FieldSet>
          {/* A channel is a long-running thread, pinned under the Channels tab. */}
          <FieldLabel htmlFor="new-thread-as-channel">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>{t('newThread.asChannel')}</FieldTitle>
                <FieldDescription>{t('newThread.asChannelHint')}</FieldDescription>
              </FieldContent>
              <Switch id="new-thread-as-channel" checked={asChannel} disabled={creating} onCheckedChange={setAsChannel} />
            </Field>
          </FieldLabel>
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" className="min-w-24" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleCreate} disabled={!canCreate}>
            {hasClaudeAgent && resumeFrom !== NO_RESUME ? t('newThread.resume') : t(asChannel ? 'newThread.startChannel' : 'newThread.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

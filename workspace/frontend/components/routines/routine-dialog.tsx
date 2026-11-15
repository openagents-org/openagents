'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { RoutineDraft, RoutineItem, WorkspaceAgent } from '@/lib/types';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import { CircleAlert } from 'lucide-react';
import { routineErrorMessage } from './routine-error';
import { ALL_DAYS, DEFAULT_SCHEDULE, RoutineScheduleFields, type RoutineSchedule } from './routine-schedule-fields';

interface RoutineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  conversationHistory?: string;
  /** Present → edit this routine in place; absent → create a new one. */
  routine?: RoutineItem | null;
  onCreateRoutine: (params: RoutineDraft) => Promise<void>;
  onUpdateRoutine?: (routineId: string, params: Partial<RoutineDraft>) => Promise<void>;
}

const ownerOf = (routine: RoutineItem) => routine.createdBy.replace('openagents:', '');

export function RoutineDialog({
  open,
  onOpenChange,
  agents,
  conversationHistory,
  routine,
  onCreateRoutine,
  onUpdateRoutine,
}: RoutineDialogProps) {
  const t = useT();
  const isEdit = Boolean(routine);
  const onlineAgents = useMemo(() => agents.filter((a) => a.status === 'online'), [agents]);
  const defaultAgent = onlineAgents.find((a) => a.role === 'master')?.agentName || onlineAgents[0]?.agentName || '';

  // A routine outlives its agent's session, so the one being edited may be
  // owned by an agent that is currently offline — keep it selectable rather
  // than silently reassigning the routine to whoever happens to be online.
  const agentOptions = useMemo(() => {
    const options = onlineAgents.map((a) => ({ value: a.agentName, label: agentLabel(a) }));
    const owner = routine ? ownerOf(routine) : '';
    if (owner && !options.some((o) => o.value === owner)) {
      const known = agents.find((a) => a.agentName === owner);
      options.push({ value: owner, label: known ? agentLabel(known) : owner });
    }
    return options;
  }, [agents, onlineAgents, routine]);

  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [nameManual, setNameManual] = useState(false);
  const [source, setSource] = useState(defaultAgent);
  const [schedule, setSchedule] = useState<RoutineSchedule>(DEFAULT_SCHEDULE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setError(null);
    if (routine) {
      // Edit — show what the routine is actually set to.
      setMessage(routine.message);
      setName(routine.name);
      setNameManual(true);  // an existing name is never auto-derived from edits
      setSource(ownerOf(routine));
      setSchedule(
        routine.scheduleIntervalMinutes
          ? { ...DEFAULT_SCHEDULE, type: 'interval', intervalMinutes: routine.scheduleIntervalMinutes }
          : {
              ...DEFAULT_SCHEDULE,
              hour: routine.scheduleHour,
              minute: routine.scheduleMinute,
              days: [...new Set(routine.scheduleDays ?? ALL_DAYS)].sort((a, b) => a - b),
            },
      );
      return;
    }
    setMessage('');
    setName('');
    setNameManual(false);
    setSource(defaultAgent);
    setSchedule(DEFAULT_SCHEDULE);
  }, [open, defaultAgent, routine]);

  const handleMessageChange = useCallback((value: string) => {
    setMessage(value);
    if (!nameManual) {
      const words = value.trim().split(/\s+/).slice(0, 6).join(' ');
      setName(words.length > 50 ? words.slice(0, 50) : words);
    }
  }, [nameManual]);

  const handleSubmit = async () => {
    if (!message.trim() || !name.trim() || !source) return;
    setSubmitting(true);
    setError(null);
    try {
      const params: Partial<RoutineDraft> = {
        name: name.trim(),
        message: message.trim(),
      };
      if (schedule.type === 'interval') {
        params.interval_minutes = schedule.intervalMinutes;
      } else {
        params.hour = schedule.hour;
        params.minute = schedule.minute;
        params.days = [...schedule.days];
      }
      if (routine && onUpdateRoutine) {
        // Only hand over `source` when the owner actually changed — an
        // unchanged one would re-run the membership check for nothing.
        if (source !== ownerOf(routine)) params.source = `openagents:${source}`;
        await onUpdateRoutine(routine.id, params);
      } else {
        await onCreateRoutine({
          ...params,
          name: params.name!,
          message: params.message!,
          source: `openagents:${source}`,
          ...(conversationHistory ? { conversation_history: conversationHistory } : {}),
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(routineErrorMessage(err, t(isEdit ? 'routines.saveFailed' : 'routines.createFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  const isValid = message.trim() && name.trim() && source;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'routines.edit' : 'routines.create')}</DialogTitle>
          <DialogDescription>
            {t(isEdit ? 'routines.editDescription' : 'routines.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <FieldGroup className="gap-5">
            {/* Task description */}
            <Field>
              <FieldLabel htmlFor="routine-task">{t('routines.taskLabel')}</FieldLabel>
              <Textarea
                id="routine-task"
                value={message}
                onChange={(e) => handleMessageChange(e.target.value)}
                placeholder={t('routines.taskPlaceholder')}
                rows={3}
                disabled={submitting}
                className="resize-none"
              />
            </Field>

            {/* Routine name */}
            <Field>
              <FieldLabel htmlFor="routine-name">{t('routines.nameLabel')}</FieldLabel>
              <Input
                id="routine-name"
                value={name}
                onChange={(e) => { setName(e.target.value); setNameManual(true); }}
                placeholder={t('routines.namePlaceholder')}
                disabled={submitting}
              />
            </Field>

            {/* Agent selector */}
            {agentOptions.length > 1 && (
              <Field>
                <FieldLabel htmlFor="routine-agent">{t('routines.agentLabel')}</FieldLabel>
                <Select value={source} onValueChange={setSource} disabled={submitting}>
                  <SelectTrigger id="routine-agent" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {agentOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}

            <RoutineScheduleFields
              value={schedule}
              onChange={(patch) => setSchedule((prev) => ({ ...prev, ...patch }))}
              disabled={submitting}
            />

            {/* Error display */}
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-w-24"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting && <Spinner data-icon="inline-start" />}
            {isEdit
              ? t(submitting ? 'common.saving' : 'common.save')
              : t(submitting ? 'common.creating' : 'routines.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

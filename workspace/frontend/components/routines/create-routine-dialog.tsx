'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import type { WorkspaceAgent } from '@/lib/types';
import { useFormatters, useT } from '@/lib/i18n';

interface CreateRoutineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  conversationHistory?: string;
  onCreateRoutine: (params: {
    name: string;
    message: string;
    source: string;
    hour?: number;
    minute?: number;
    days?: number[];
    interval_minutes?: number;
    conversation_history?: string;
  }) => Promise<void>;
}

const INTERVAL_PRESETS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
];

// No Select primitive in this UI kit yet — keep the native element but give it
// the same tokens/focus ring as <Input>.
const selectClass =
  'w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs shadow-black/5 outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60';

/** Single-choice chips (interval presets) — exactly one is ever filled. */
const chipClass = (active: boolean) =>
  cn(
    'flex-1 rounded-md border py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60',
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
  );

/**
 * Multi-choice chips (weekdays) get a softer fill than `chipClass`. Days start
 * all-selected, and seven solid `primary` blocks read as a wall of white in dark
 * mode — louder than the dialog's own submit button.
 */
const dayChipClass = (active: boolean) =>
  cn(
    'flex-1 rounded-md border py-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-60',
    active
      ? 'border-foreground/25 bg-foreground/10 text-foreground'
      : 'border-input text-muted-foreground/70 hover:bg-muted hover:text-foreground',
  );

export function CreateRoutineDialog({ open, onOpenChange, agents, conversationHistory, onCreateRoutine }: CreateRoutineDialogProps) {
  const t = useT();
  const { weekdayLabels } = useFormatters();
  const dayLabels = weekdayLabels();
  const onlineAgents = agents.filter((a) => a.status === 'online');
  const defaultAgent = onlineAgents.find((a) => a.role === 'master')?.agentName || onlineAgents[0]?.agentName || '';

  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [nameManual, setNameManual] = useState(false);
  const [source, setSource] = useState(defaultAgent);
  const [scheduleType, setScheduleType] = useState<'daily' | 'interval'>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [days, setDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMessage('');
      setName('');
      setNameManual(false);
      setSource(defaultAgent);
      setScheduleType('daily');
      setHour(9);
      setMinute(0);
      setDays(new Set([0, 1, 2, 3, 4, 5, 6]));
      setIntervalMinutes(60);
      setSubmitting(false);
      setError(null);
    }
  }, [open, defaultAgent]);

  const handleMessageChange = useCallback((value: string) => {
    setMessage(value);
    if (!nameManual) {
      const words = value.trim().split(/\s+/).slice(0, 6).join(' ');
      setName(words.length > 50 ? words.slice(0, 50) : words);
    }
  }, [nameManual]);

  const toggleDay = (day: number) => {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        if (next.size > 1) next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!message.trim() || !name.trim() || !source) return;
    setSubmitting(true);
    setError(null);
    try {
      const params: Parameters<typeof onCreateRoutine>[0] = {
        name: name.trim(),
        message: message.trim(),
        source: `openagents:${source}`,
        ...(conversationHistory ? { conversation_history: conversationHistory } : {}),
      };
      if (scheduleType === 'interval') {
        params.interval_minutes = intervalMinutes;
      } else {
        params.hour = hour;
        params.minute = minute;
        params.days = Array.from(days).sort();
      }
      await onCreateRoutine(params);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('routines.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const isValid = message.trim() && name.trim() && source;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="space-y-3 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">{t('routines.create')}</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {t('routines.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5 px-7 py-2">
          {/* Task description */}
          <div className="space-y-2">
            <Label variant="secondary">{t('routines.taskLabel')}</Label>
            <Textarea
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              placeholder={t('routines.taskPlaceholder')}
              rows={3}
              disabled={submitting}
              className="resize-none"
            />
          </div>

          {/* Routine name */}
          <div className="space-y-2">
            <Label variant="secondary">{t('routines.nameLabel')}</Label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameManual(true); }}
              placeholder={t('routines.namePlaceholder')}
              disabled={submitting}
            />
          </div>

          {/* Agent selector */}
          {onlineAgents.length > 1 && (
            <div className="space-y-2">
              <Label variant="secondary">{t('routines.agentLabel')}</Label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={submitting}
                className={selectClass}
              >
                {onlineAgents.map((a) => (
                  <option key={a.agentName} value={a.agentName}>{a.agentName}</option>
                ))}
              </select>
            </div>
          )}

          {/* Schedule type toggle */}
          <div className="space-y-2">
            <Label variant="secondary">{t('routines.scheduleLabel')}</Label>
            <div className="flex gap-1 rounded-md bg-muted p-0.5">
              {(['daily', 'interval'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setScheduleType(type)}
                  disabled={submitting}
                  className={cn(
                    'flex-1 rounded-md py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60',
                    scheduleType === type
                      // A ring as well as the shadow: on the near-black dark
                      // surface a drop shadow alone doesn't separate the active
                      // segment from the track behind it.
                      ? 'bg-background text-foreground shadow-xs shadow-black/5 ring-1 ring-foreground/10'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {type === 'daily' ? t('routines.scheduleDaily') : t('routines.scheduleInterval')}
                </button>
              ))}
            </div>
          </div>

          {/* Daily schedule config */}
          {scheduleType === 'daily' && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 space-y-2">
                  <Label variant="secondary">{t('routines.hourLabel')}</Label>
                  <select
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value))}
                    disabled={submitting}
                    className={selectClass}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 space-y-2">
                  <Label variant="secondary">{t('routines.minuteLabel')}</Label>
                  <select
                    value={minute}
                    onChange={(e) => setMinute(Number(e.target.value))}
                    disabled={submitting}
                    className={selectClass}
                  >
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label variant="secondary">{t('routines.daysLabel')}</Label>
                <div className="flex gap-1.5">
                  {dayLabels.map((label, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      disabled={submitting}
                      aria-pressed={days.has(i)}
                      className={cn(dayChipClass(days.has(i)), 'px-0')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Interval schedule config */}
          {scheduleType === 'interval' && (
            <div className="space-y-3">
              <div className="flex gap-1.5">
                {INTERVAL_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setIntervalMinutes(preset.value)}
                    disabled={submitting}
                    className={chipClass(intervalMinutes === preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('routines.every')}</span>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))}
                  disabled={submitting}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">{t('routines.minutes')}</span>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>

        <DialogFooter className="px-7 pt-7 pb-7 sm:space-x-3">
          <Button
            variant="outline"
            className="min-w-24"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? t('common.creating') : t('routines.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

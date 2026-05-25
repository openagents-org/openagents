'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import type { WorkspaceAgent } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';

interface CreateRoutineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  onCreateRoutine: (params: {
    name: string;
    message: string;
    source: string;
    hour?: number;
    minute?: number;
    days?: number[];
    interval_minutes?: number;
  }) => Promise<void>;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const INTERVAL_PRESETS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
];

export function CreateRoutineDialog({ open, onOpenChange, agents, onCreateRoutine }: CreateRoutineDialogProps) {
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
      setError(err instanceof Error ? err.message : 'Failed to create routine');
    } finally {
      setSubmitting(false);
    }
  };

  const isValid = message.trim() && name.trim() && source;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Create Routine</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Set up a recurring task for an agent.
        </DialogDescription>

        <div className="mt-3 space-y-4">
          {/* Task description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">What should the agent do?</label>
            <textarea
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              placeholder="e.g. Check the deployment status and report any issues"
              rows={3}
              disabled={submitting}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Routine name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Routine name</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameManual(true); }}
              placeholder="Short label for this routine"
              disabled={submitting}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Agent selector */}
          {onlineAgents.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Agent</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={submitting}
                className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {onlineAgents.map((a) => (
                  <option key={a.agentName} value={a.agentName}>{a.agentName}</option>
                ))}
              </select>
            </div>
          )}

          {/* Schedule type toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Schedule</label>
            <div className="flex gap-1 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <button
                onClick={() => setScheduleType('daily')}
                disabled={submitting}
                className={cn(
                  'flex-1 text-xs font-medium py-1.5 rounded-md transition-colors',
                  scheduleType === 'daily'
                    ? 'bg-white dark:bg-zinc-700 shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Daily
              </button>
              <button
                onClick={() => setScheduleType('interval')}
                disabled={submitting}
                className={cn(
                  'flex-1 text-xs font-medium py-1.5 rounded-md transition-colors',
                  scheduleType === 'interval'
                    ? 'bg-white dark:bg-zinc-700 shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Interval
              </button>
            </div>
          </div>

          {/* Daily schedule config */}
          {scheduleType === 'daily' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground">Hour (UTC)</label>
                  <select
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value))}
                    disabled={submitting}
                    className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground">Minute</label>
                  <select
                    value={minute}
                    onChange={(e) => setMinute(Number(e.target.value))}
                    disabled={submitting}
                    className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Days</label>
                <div className="flex gap-1">
                  {DAY_LABELS.map((label, i) => (
                    <button
                      key={i}
                      onClick={() => toggleDay(i)}
                      disabled={submitting}
                      className={cn(
                        'flex-1 text-[10px] font-medium py-1.5 rounded-md transition-colors border',
                        days.has(i)
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'border-zinc-200 dark:border-zinc-700 text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      )}
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
            <div className="space-y-2">
              <div className="flex gap-1.5">
                {INTERVAL_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setIntervalMinutes(preset.value)}
                    disabled={submitting}
                    className={cn(
                      'flex-1 text-xs font-medium py-1.5 rounded-md transition-colors border',
                      intervalMinutes === preset.value
                        ? 'bg-blue-500 border-blue-500 text-white'
                        : 'border-zinc-200 dark:border-zinc-700 text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))}
                  disabled={submitting}
                  className="w-20 px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Creating...
              </>
            ) : (
              'Create Routine'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

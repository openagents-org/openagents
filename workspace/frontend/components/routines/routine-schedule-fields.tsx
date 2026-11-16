'use client';

import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useFormatters, useT } from '@/lib/i18n';

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** When a routine runs: at a time of day on chosen weekdays, or every N minutes. */
export type RoutineSchedule = {
  type: 'daily' | 'interval';
  hour: number;
  minute: number;
  /** Weekdays, 0 = Sunday. Never empty. */
  days: number[];
  intervalMinutes: number;
};

export const DEFAULT_SCHEDULE: RoutineSchedule = {
  type: 'daily',
  hour: 9,
  minute: 0,
  days: ALL_DAYS,
  intervalMinutes: 60,
};

const INTERVAL_PRESETS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
];

const pad = (n: number) => String(n).padStart(2, '0');

export function RoutineScheduleFields({
  value,
  onChange,
  disabled,
}: {
  value: RoutineSchedule;
  onChange: (patch: Partial<RoutineSchedule>) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { weekdayLabels } = useFormatters();
  const dayLabels = weekdayLabels();

  return (
    <>
      <Field>
        <FieldLabel>{t('routines.scheduleLabel')}</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={value.type}
          onValueChange={(v) => { if (v) onChange({ type: v as RoutineSchedule['type'] }); }}
          disabled={disabled}
          className="w-full"
        >
          <ToggleGroupItem value="daily" className="flex-1">{t('routines.scheduleDaily')}</ToggleGroupItem>
          <ToggleGroupItem value="interval" className="flex-1">{t('routines.scheduleInterval')}</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      {value.type === 'daily' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <Field className="flex-1">
              <FieldLabel htmlFor="routine-hour">{t('routines.hourLabel')}</FieldLabel>
              <Select value={String(value.hour)} onValueChange={(v) => onChange({ hour: Number(v) })} disabled={disabled}>
                <SelectTrigger id="routine-hour" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{pad(i)}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="routine-minute">{t('routines.minuteLabel')}</FieldLabel>
              <Select value={String(value.minute)} onValueChange={(v) => onChange({ minute: Number(v) })} disabled={disabled}>
                <SelectTrigger id="routine-minute" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {/* An edited routine can sit on a minute the presets
                        don't offer (agent-created, or a 5-minute grid that
                        changed) — keep its own value in the list. */}
                    {Array.from(new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, value.minute]))
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <SelectItem key={m} value={String(m)}>{pad(m)}</SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel>{t('routines.daysLabel')}</FieldLabel>
            {/* At least one day stays selected: clearing the last one is ignored. */}
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              value={value.days.map(String)}
              onValueChange={(v) => {
                if (v.length > 0) onChange({ days: v.map(Number).sort((a, b) => a - b) });
              }}
              disabled={disabled}
              className="w-full"
            >
              {dayLabels.map((label, i) => (
                <ToggleGroupItem key={i} value={String(i)} className="flex-1 px-0 text-xs">
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </div>
      )}

      {value.type === 'interval' && (
        <div className="flex flex-col gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            value={INTERVAL_PRESETS.some((p) => p.value === value.intervalMinutes) ? String(value.intervalMinutes) : ''}
            onValueChange={(v) => { if (v) onChange({ intervalMinutes: Number(v) }); }}
            disabled={disabled}
            className="w-full"
            aria-label={t('routines.scheduleInterval')}
          >
            {INTERVAL_PRESETS.map((preset) => (
              <ToggleGroupItem key={preset.value} value={String(preset.value)} className="flex-1">
                {preset.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('routines.every')}</span>
            <Input
              type="number"
              min={1}
              max={1440}
              value={value.intervalMinutes}
              onChange={(e) => onChange({ intervalMinutes: Math.max(1, Math.min(1440, Number(e.target.value) || 1)) })}
              disabled={disabled}
              aria-label={t('routines.minutes')}
              className="w-20"
            />
            <span className="text-xs text-muted-foreground">{t('routines.minutes')}</span>
          </div>
        </div>
      )}
    </>
  );
}

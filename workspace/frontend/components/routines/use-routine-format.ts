'use client';

import { useCallback, useMemo } from 'react';
import { useFormatters, useT } from '@/lib/i18n';
import type { RoutineItem } from '@/lib/types';

/**
 * Locale-aware summaries for a routine's schedule and next run.
 *
 * Shared by the routine list and the routines view, which previously each
 * carried their own copy of this formatting (and their own hardcoded English
 * weekday names).
 */
export function useRoutineFormat() {
  const t = useT();
  const { weekdayLabels } = useFormatters();
  const dayNames = useMemo(() => weekdayLabels(), [weekdayLabels]);

  /** "Daily at 09:00 UTC" / "每天 09:00 UTC" */
  const formatSchedule = useCallback(
    (routine: RoutineItem): string => {
      if (routine.scheduleIntervalMinutes) {
        const total = routine.scheduleIntervalMinutes;
        if (total < 60) return t('routines.everyMinutes', { minutes: total });
        const hours = Math.floor(total / 60);
        const minutes = total % 60;
        return minutes
          ? t('routines.everyHoursMinutes', { hours, minutes })
          : t('routines.everyHours', { hours });
      }

      const time = `${String(routine.scheduleHour).padStart(2, '0')}:${String(
        routine.scheduleMinute,
      ).padStart(2, '0')} UTC`;
      const days = routine.scheduleDays;

      if (!days || days.length === 7) return t('routines.dailyAt', { time });
      if (days.length === 5 && [0, 1, 2, 3, 4].every((d) => days.includes(d))) {
        return t('routines.weekdaysAt', { time });
      }
      if (days.length === 2 && [5, 6].every((d) => days.includes(d))) {
        return t('routines.weekendsAt', { time });
      }
      return t('routines.daysAt', {
        days: days.map((d) => dayNames[d] ?? String(d)).join(', '),
        time,
      });
    },
    [t, dayNames],
  );

  /** Countdown to the next run: "2h 15m" / "2 小时 15 分". */
  const timeUntil = useCallback(
    (dateStr: string): string => {
      const diff = new Date(dateStr).getTime() - Date.now();
      if (diff < 0) return t('routines.overdue');
      const minutes = Math.floor(diff / 60_000);
      if (minutes < 1) return t('routines.underOneMinute');
      if (minutes < 60) return t('routines.inMinutes', { minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('routines.inHours', { hours, minutes: minutes % 60 });
      return t('routines.inDays', { days: Math.floor(hours / 24) });
    },
    [t],
  );

  return { formatSchedule, timeUntil };
}

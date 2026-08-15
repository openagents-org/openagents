/**
 * Locale-aware formatting built on `Intl`.
 *
 * Relative times, dates, numbers and byte sizes deliberately go through `Intl`
 * rather than the message catalogue: the platform already knows that English
 * says "5 minutes ago" and Chinese says "5分钟前", and hand-written strings for
 * these drift out of sync with every locale added.
 */

import type { Locale } from './locales';

// `Intl` formatter construction is comparatively expensive and these are called
// inside render, so keep one instance per (locale, shape).
const relativeTimeCache = new Map<string, Intl.RelativeTimeFormat>();
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();

function getRelativeTimeFormat(locale: Locale): Intl.RelativeTimeFormat {
  let formatter = relativeTimeCache.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeTimeCache.set(locale, formatter);
  }
  return formatter;
}

function getDateTimeFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateTimeCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeCache.set(key, formatter);
  }
  return formatter;
}

function getNumberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberCache.set(key, formatter);
  }
  return formatter;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Thresholds in seconds, largest first, paired with their `Intl` unit. */
const RELATIVE_UNITS: Array<[seconds: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [31536000, 'year'],
  [2592000, 'month'],
  [604800, 'week'],
  [86400, 'day'],
  [3600, 'hour'],
  [60, 'minute'],
];

/**
 * "5 minutes ago" / "5分钟前". Anything under a minute returns `justNowLabel`,
 * which the caller supplies from the catalogue (`common.justNow`) since `Intl`
 * has no equivalent.
 *
 * Returns an empty string for a missing or unparseable date so call sites can
 * interpolate the result directly.
 */
export function formatRelativeTime(
  value: Date | string | number | null | undefined,
  locale: Locale,
  justNowLabel: string,
): string {
  const date = toDate(value);
  if (!date) return '';

  const elapsedSeconds = (date.getTime() - Date.now()) / 1000;
  const magnitude = Math.abs(elapsedSeconds);
  if (magnitude < 60) return justNowLabel;

  for (const [seconds, unit] of RELATIVE_UNITS) {
    if (magnitude >= seconds) {
      const amount = Math.round(elapsedSeconds / seconds);
      return getRelativeTimeFormat(locale).format(amount, unit);
    }
  }
  return justNowLabel;
}

/** Compact relative time for dense lists: `5m`, `3h`, `2d`, `4w`. */
export function formatRelativeTimeShort(
  value: Date | string | number | null | undefined,
  locale: Locale,
  justNowLabel: string,
): string {
  const date = toDate(value);
  if (!date) return '';

  const elapsedSeconds = (date.getTime() - Date.now()) / 1000;
  const magnitude = Math.abs(elapsedSeconds);
  if (magnitude < 60) return justNowLabel;

  for (const [seconds, unit] of RELATIVE_UNITS) {
    if (magnitude >= seconds) {
      const amount = Math.round(elapsedSeconds / seconds);
      const parts = getRelativeTimeFormat(locale)
        .formatToParts(amount, unit)
        .filter((part) => part.type !== 'literal' || part.value.trim() !== '');
      return parts.map((part) => part.value).join('').trim();
    }
  }
  return justNowLabel;
}

/** Long-form date: "March 5, 2026" / "2026年3月5日". */
export function formatDate(
  value: Date | string | number | null | undefined,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
): string {
  const date = toDate(value);
  if (!date) return '';
  return getDateTimeFormat(locale, options).format(date);
}

/** Date plus clock time, e.g. for message timestamps. */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
): string {
  return formatDate(value, locale, options);
}

/** Clock time only, e.g. "14:32" / "2:32 PM". */
export function formatTime(
  value: Date | string | number | null | undefined,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  return formatDate(value, locale, options);
}

const weekdayCache = new Map<string, string[]>();

/**
 * Weekday names in the active locale, Monday-first — "Mon…Sun" / "周一…周日".
 * Derived from `Intl` rather than a hardcoded array so every locale gets the
 * right abbreviations for free.
 */
export function getWeekdayLabels(
  locale: Locale,
  weekday: Intl.DateTimeFormatOptions['weekday'] = 'short',
): string[] {
  const key = `${locale}:${weekday}`;
  const cached = weekdayCache.get(key);
  if (cached) return cached;

  // 2024-01-01 was a Monday, so day N of that week is index N.
  const monday = Date.UTC(2024, 0, 1);
  const formatter = getDateTimeFormat(locale, { weekday, timeZone: 'UTC' });
  const labels = Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(monday + index * 86_400_000)),
  );
  weekdayCache.set(key, labels);
  return labels;
}

/** Grouped number, e.g. "1,234" / "1,234". */
export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) return '';
  return getNumberFormat(locale, options).format(value);
}

/**
 * Byte size with a locale-formatted mantissa: "1.4 MB" / "1.4 MB".
 * Units stay in the SI-ish shorthand every locale uses in file managers.
 */
export function formatFileSize(bytes: number | null | undefined, locale: Locale): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${formatNumber(bytes, locale)} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 1;
  return `${formatNumber(size, locale, { maximumFractionDigits: digits })} ${units[unitIndex]}`;
}

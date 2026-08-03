/**
 * Client-safe i18n entry point.
 *
 * `./server` is deliberately not re-exported here — it imports `next/headers`
 * and must only be pulled in from Server Components.
 */

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_LABELS,
  detectBrowserLocale,
  isLocale,
  localeFromAcceptLanguage,
  localeFromRegion,
  localeFromTimeZone,
  matchLocale,
  type Locale,
} from './locales';

export { I18nProvider, useFormatters, useI18n, useT, type TranslateFn } from './i18n-context';

export { translate, type MessageKey, type PluralMessage, type TranslateParams } from './translate';

export {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  formatRelativeTime,
  formatRelativeTimeShort,
  formatTime,
  getWeekdayLabels,
} from './format';

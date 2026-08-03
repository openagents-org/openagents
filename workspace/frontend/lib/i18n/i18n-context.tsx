'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  detectBrowserLocale,
  isLocale,
  type Locale,
} from './locales';
import { translate, type MessageKey, type TranslateParams } from './translate';
import { FALLBACK_CATALOGUE, getCatalogue } from './messages';
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  formatRelativeTime,
  formatRelativeTimeShort,
  formatTime,
  getWeekdayLabels,
} from './format';

export type TranslateFn = (key: MessageKey, params?: TranslateParams) => string;

interface I18nContextValue {
  /** The active locale, always a full BCP 47 tag. */
  locale: Locale;
  /** Translates a dot-path key. */
  t: TranslateFn;
  /** Switches locale and persists the choice for future requests. */
  setLocale: (locale: Locale) => void;
  /** True while the locale still comes from detection rather than a stored choice. */
  isAutoDetected: boolean;
  /** Clears the stored choice and re-detects from the browser/region. */
  resetLocale: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function writeLocaleCookie(locale: Locale | null) {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = locale
    ? `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`
    : `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function I18nProvider({
  initialLocale,
  /**
   * Whether `initialLocale` came from the persisted cookie (an explicit choice)
   * or from request-header detection. Only the latter may be overridden by
   * client-side detection.
   */
  hasStoredLocale = false,
  children,
}: {
  initialLocale?: Locale;
  hasStoredLocale?: boolean;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);
  const [isAutoDetected, setIsAutoDetected] = useState(!hasStoredLocale);

  // Refine the server's guess once we're in the browser. This only runs when
  // the visitor has no stored choice — e.g. a request that reached us without
  // `Accept-Language`, or a CDN-cached shell. Deferring it to an effect (rather
  // than detecting during render) is what keeps SSR and hydration in agreement.
  const refined = useRef(false);
  useEffect(() => {
    if (hasStoredLocale || refined.current) return;
    refined.current = true;
    const detected = detectBrowserLocale();
    if (detected && detected !== locale) setLocaleState(detected);
  }, [hasStoredLocale, locale]);

  // Keep `<html lang>` in step so screen readers, `:lang()` rules, and the
  // browser's own translation prompt see the language actually on screen.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    refined.current = true;
    setLocaleState(next);
    setIsAutoDetected(false);
    writeLocaleCookie(next);
  }, []);

  const resetLocale = useCallback(() => {
    refined.current = true;
    writeLocaleCookie(null);
    setIsAutoDetected(true);
    setLocaleState(detectBrowserLocale() ?? DEFAULT_LOCALE);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const catalogue = getCatalogue(locale);
    return {
      locale,
      isAutoDetected,
      setLocale,
      resetLocale,
      t: (key, params) => translate(catalogue, FALLBACK_CATALOGUE, locale, key, params),
    };
  }, [locale, isAutoDetected, setLocale, resetLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an <I18nProvider>');
  return ctx;
}

/** Shorthand for components that only need the translate function. */
export function useT(): TranslateFn {
  return useI18n().t;
}

/**
 * `Intl` formatters pre-bound to the active locale, so components don't have to
 * thread `locale` through every call.
 */
export function useFormatters() {
  const { locale, t } = useI18n();

  return useMemo(() => {
    const justNow = t('common.justNow');
    return {
      locale,
      /** "5 minutes ago" / "5分钟前" */
      timeAgo: (value: Date | string | number | null | undefined) =>
        formatRelativeTime(value, locale, justNow),
      /** Compact form for dense lists: "5m", "2d" */
      timeAgoShort: (value: Date | string | number | null | undefined) =>
        formatRelativeTimeShort(value, locale, justNow),
      formatDate: (value: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions) =>
        formatDate(value, locale, options),
      formatDateTime: (value: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions) =>
        formatDateTime(value, locale, options),
      formatTime: (value: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions) =>
        formatTime(value, locale, options),
      formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
        formatNumber(value, locale, options),
      formatFileSize: (bytes: number | null | undefined) => formatFileSize(bytes, locale),
      /** Monday-first weekday names for schedule pickers. */
      weekdayLabels: (weekday?: Intl.DateTimeFormatOptions['weekday']) =>
        getWeekdayLabels(locale, weekday),
    };
  }, [locale, t]);
}

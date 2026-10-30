import { DEFAULT_LOCALE, type Locale } from './locales';
import { translate, type MessageKey, type TranslateParams } from './translate';
import { FALLBACK_CATALOGUE, getCatalogue } from './messages';

/**
 * The locale the I18nProvider last rendered with, for plain functions that
 * cannot call `useT` (agentLabel). The provider sets it before its children
 * render, so a component reading it during render sees that same pass's locale.
 * Kept out of i18n-context so modules without 'use client' can import it.
 */
let activeLocale: Locale = DEFAULT_LOCALE;

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

/** Translates with the provider's current locale, outside of React hooks. */
export function translateActive(key: MessageKey, params?: TranslateParams): string {
  return translate(getCatalogue(activeLocale), FALLBACK_CATALOGUE, activeLocale, key, params);
}

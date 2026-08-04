import type { Locale } from '../locales';
import enUS, { type Messages } from './en-US';
import zhCN from './zh-CN';

/**
 * Every catalogue, keyed by locale. Imported statically (rather than via
 * `import()`) so locale switching is synchronous on the client and needs no
 * suspense boundary — the catalogues are small next to the app bundle.
 */
export const CATALOGUES: Record<Locale, Messages> = {
  'en-US': enUS,
  'zh-CN': zhCN,
};

/** The catalogue that untranslated keys fall back to. */
export const FALLBACK_CATALOGUE = enUS;

export function getCatalogue(locale: Locale): Messages {
  return CATALOGUES[locale] ?? FALLBACK_CATALOGUE;
}

export type { Messages };

// Server-only: importing `next/headers` from a Client Component is a build
// error, which is the guard we want here — no extra `server-only` dependency.
import { cookies, headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  localeFromRegion,
  type Locale,
} from './locales';
import { FALLBACK_CATALOGUE, getCatalogue } from './messages';
import { translate, type MessageKey, type TranslateParams } from './translate';

/**
 * Geo headers injected by common edge platforms. Used only as a secondary
 * signal: `Accept-Language` reflects what the visitor asked for, whereas the
 * request's origin country reflects where they happen to be sitting.
 */
const GEO_HEADERS = ['x-vercel-ip-country', 'cf-ipcountry', 'x-country-code'];

export interface ResolvedLocale {
  locale: Locale;
  /** True when the visitor has an explicit, persisted choice. */
  hasStoredLocale: boolean;
}

/**
 * Resolves the locale for the incoming request, in decreasing order of
 * authority:
 *
 *   1. The `oa_locale` cookie — an explicit choice always wins.
 *   2. `Accept-Language` — the visitor's configured browser languages.
 *   3. An edge geo header — catches an English browser used from a Chinese
 *      region.
 *   4. `DEFAULT_LOCALE`.
 *
 * Steps 2-4 are a guess, so the result is flagged `hasStoredLocale: false` and
 * the client provider is allowed to refine it (e.g. from the device time zone).
 */
export async function resolveLocale(): Promise<ResolvedLocale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return { locale: stored, hasStoredLocale: true };

  const headerList = await headers();

  const fromLanguage = localeFromAcceptLanguage(headerList.get('accept-language'));
  if (fromLanguage) return { locale: fromLanguage, hasStoredLocale: false };

  for (const name of GEO_HEADERS) {
    const fromRegion = localeFromRegion(headerList.get(name));
    if (fromRegion) return { locale: fromRegion, hasStoredLocale: false };
  }

  return { locale: DEFAULT_LOCALE, hasStoredLocale: false };
}

/**
 * Translator for Server Components and `generateMetadata`, using the same
 * catalogues and fallback chain as the client hook.
 */
export async function getServerTranslations(): Promise<{
  locale: Locale;
  t: (key: MessageKey, params?: TranslateParams) => string;
}> {
  const { locale } = await resolveLocale();
  const catalogue = getCatalogue(locale);
  return {
    locale,
    t: (key, params) => translate(catalogue, FALLBACK_CATALOGUE, locale, key, params),
  };
}

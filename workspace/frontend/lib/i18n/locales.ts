/**
 * Locale definitions, matching, and region detection.
 *
 * Locale keys are full BCP 47 tags (`en-US`, `zh-CN`) rather than bare language
 * subtags, so adding a script/region variant later — `zh-TW` being the expected
 * one — is additive: append it to `LOCALES`, give it a message file, and the
 * matcher below routes Traditional Chinese visitors to it automatically.
 *
 * Shared by the server (root layout resolves the initial locale from request
 * headers) and the client (provider refines it from the browser when the
 * request carried no useful signal). Keep this file free of React and of
 * `next/*` imports so both environments can pull it in.
 */

export const LOCALES = ['en-US', 'zh-CN'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en-US';

/** Cookie holding the resolved locale. Read server-side on every request. */
export const LOCALE_COOKIE = 'oa_locale';

/** One year — the choice should survive well past a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Native names, used for the language switcher. */
export const LOCALE_LABELS: Record<Locale, string> = {
  'en-US': 'English',
  'zh-CN': '简体中文',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Language matching
// ---------------------------------------------------------------------------

/**
 * Fallback locale per language subtag, used when a request names a language we
 * support but a region/script we don't (`zh-SG` → `zh-CN`, `en-GB` → `en-US`).
 */
const LANGUAGE_FALLBACK: Record<string, Locale> = {
  en: 'en-US',
  zh: 'zh-CN',
};

/**
 * Regions and scripts that imply Traditional Chinese. Kept separate from the
 * locale list because we don't ship `zh-TW` yet — these currently fall through
 * to `zh-CN`, and start resolving on their own the moment `zh-TW` is added.
 */
const TRADITIONAL_CHINESE_SUBTAGS = new Set(['hant', 'tw', 'hk', 'mo']);

/** Splits a tag into its lowercase subtags, e.g. `zh-Hant-TW` → `[zh, hant, tw]`. */
function subtags(tag: string): string[] {
  return tag.trim().toLowerCase().split(/[-_]/).filter(Boolean);
}

/**
 * Maps an arbitrary BCP 47 language tag onto a supported locale.
 *
 * Resolution order: exact match → script/region-aware match within the same
 * language → that language's default variant → `null`.
 */
export function matchLocale(tag: string): Locale | null {
  const parts = subtags(tag);
  const language = parts[0];
  if (!language) return null;

  // Exact match (case-insensitive), e.g. `ZH-cn` → `zh-CN`.
  const exact = LOCALES.find((locale) => locale.toLowerCase() === parts.join('-'));
  if (exact) return exact;

  // Chinese needs script awareness: `zh-TW` and `zh-Hant` must not silently
  // resolve to Simplified once a Traditional locale exists.
  if (language === 'zh') {
    const wantsTraditional = parts.slice(1).some((part) => TRADITIONAL_CHINESE_SUBTAGS.has(part));
    const preferred = LOCALES.find((locale) => {
      if (!locale.startsWith('zh')) return false;
      const isTraditional = subtags(locale)
        .slice(1)
        .some((part) => TRADITIONAL_CHINESE_SUBTAGS.has(part));
      return isTraditional === wantsTraditional;
    });
    if (preferred) return preferred;
  }

  // Same language, any variant we happen to ship.
  return LANGUAGE_FALLBACK[language] ?? LOCALES.find((locale) => locale.startsWith(`${language}-`)) ?? null;
}

/**
 * Picks the best supported locale out of an `Accept-Language` header,
 * honouring q-values (`zh-CN,zh;q=0.9,en;q=0.8`).
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.split(';').map((s) => s.trim());
      const q = params
        .map((p) => (p.startsWith('q=') ? Number.parseFloat(p.slice(2)) : Number.NaN))
        .find((n) => !Number.isNaN(n));
      return { tag, quality: q === undefined || Number.isNaN(q) ? 1 : q };
    })
    .filter((entry) => entry.tag && entry.tag !== '*')
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Region detection
// ---------------------------------------------------------------------------

/**
 * ISO 3166-1 alpha-2 codes (e.g. from a CDN geo header) → language tag.
 * Mapped to tags rather than locales so `matchLocale` applies the same
 * script-aware fallback used everywhere else.
 */
const REGION_LANGUAGE: Record<string, string> = {
  CN: 'zh-CN',
  SG: 'zh-CN',
  HK: 'zh-HK',
  MO: 'zh-MO',
  TW: 'zh-TW',
};

/** Maps an ISO country code onto a locale. */
export function localeFromRegion(region: string | null | undefined): Locale | null {
  if (!region) return null;
  const tag = REGION_LANGUAGE[region.trim().toUpperCase()];
  return tag ? matchLocale(tag) : null;
}

/** IANA time zones → language tag. Last-resort region signal. */
const TIME_ZONE_LANGUAGE: Record<string, string> = {
  'Asia/Shanghai': 'zh-CN',
  'Asia/Chongqing': 'zh-CN',
  'Asia/Chungking': 'zh-CN',
  'Asia/Harbin': 'zh-CN',
  'Asia/Urumqi': 'zh-CN',
  'Asia/Kashgar': 'zh-CN',
  'Asia/Singapore': 'zh-CN',
  PRC: 'zh-CN',
  'Asia/Hong_Kong': 'zh-HK',
  'Asia/Macau': 'zh-MO',
  'Asia/Macao': 'zh-MO',
  'Asia/Taipei': 'zh-TW',
  ROC: 'zh-TW',
};

/** Maps an IANA time zone onto a locale. */
export function localeFromTimeZone(timeZone: string | null | undefined): Locale | null {
  if (!timeZone) return null;
  const tag = TIME_ZONE_LANGUAGE[timeZone.trim()];
  return tag ? matchLocale(tag) : null;
}

/**
 * Browser-side region detection, in decreasing order of confidence:
 *   1. `navigator.languages` — what the user actually configured.
 *   2. The device time zone — catches an `en-US` browser physically in China.
 *
 * Returns `null` when nothing points at a supported locale, so the caller can
 * keep whatever the server already decided.
 */
export function detectBrowserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null;

  const tags = navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : [];

  for (const tag of tags) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }

  try {
    return localeFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

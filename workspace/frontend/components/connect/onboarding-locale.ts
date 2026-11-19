import { ONBOARDING_LOCALES, type OnboardingLocale } from './onboarding-messages';

export const ONBOARDING_LANGUAGE_KEY = 'oa_onboarding_language';

export function isOnboardingLocale(value: unknown): value is OnboardingLocale {
  return typeof value === 'string' && (ONBOARDING_LOCALES as readonly string[]).includes(value);
}

export function matchOnboardingLocale(tag: string): OnboardingLocale | null {
  const language = tag.trim().toLowerCase().split(/[-_]/)[0];
  return ONBOARDING_LOCALES.find(locale => locale.split('-')[0] === language) ?? null;
}

/** An explicit choice wins; location never overrides configured languages. */
export function resolveOnboardingLocale({ choice, workspaceLocale, workspaceExplicit, browserLanguages = [] }: {
  choice?: unknown;
  workspaceLocale: string;
  workspaceExplicit: boolean;
  browserLanguages?: readonly string[];
}): OnboardingLocale {
  if (isOnboardingLocale(choice)) return choice;
  if (workspaceExplicit) {
    const saved = matchOnboardingLocale(workspaceLocale);
    if (saved) return saved;
  }
  for (const language of browserLanguages) {
    const match = matchOnboardingLocale(language);
    if (match) return match;
  }
  return matchOnboardingLocale(workspaceLocale) ?? 'en-US';
}

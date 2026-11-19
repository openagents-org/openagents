'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { ONBOARDING_LANGUAGE_NAMES, ONBOARDING_LOCALES, onboardingText, type OnboardingLocale, type OnboardingMessageKey } from './onboarding-messages';
import { isOnboardingLocale, ONBOARDING_LANGUAGE_KEY, resolveOnboardingLocale } from './onboarding-locale';
import styles from './welcome-scroll.module.css';

type Choice = OnboardingLocale | 'auto';
type LanguageContext = {
  locale: OnboardingLocale;
  automaticLocale: OnboardingLocale;
  choice: Choice;
  setChoice: (value: Choice) => void;
  t: (key: OnboardingMessageKey, params?: Record<string, string | number>) => string;
};
const Context = createContext<LanguageContext | null>(null);

/** Scoped to this tour: extra onboarding languages don't advertise app-wide translations. */
function LanguageProvider({ children }: { children: ReactNode }) {
  const workspace = useI18n();
  const [choice, setChoiceState] = useState<Choice>('auto');
  const [browserLanguages, setBrowserLanguages] = useState<readonly string[]>([]);

  useEffect(() => {
    const detect = () => setBrowserLanguages(navigator.languages?.length ? navigator.languages : [navigator.language]);
    detect();
    try {
      const saved = localStorage.getItem(ONBOARDING_LANGUAGE_KEY);
      if (isOnboardingLocale(saved)) setChoiceState(saved);
    } catch { /* The switcher still works when browser storage is unavailable. */ }
    window.addEventListener('languagechange', detect);
    return () => window.removeEventListener('languagechange', detect);
  }, []);

  const automaticLocale = resolveOnboardingLocale({ workspaceLocale: workspace.locale, workspaceExplicit: !workspace.isAutoDetected, browserLanguages });
  const locale = choice === 'auto' ? automaticLocale : choice;
  const setChoice = (next: Choice) => {
    if (next !== 'auto' && !isOnboardingLocale(next)) return;
    setChoiceState(next);
    try {
      if (next === 'auto') localStorage.removeItem(ONBOARDING_LANGUAGE_KEY);
      else localStorage.setItem(ONBOARDING_LANGUAGE_KEY, next);
    } catch { /* A blocked preference store must not block onboarding. */ }
  };
  return <Context.Provider value={{ locale, automaticLocale, choice, setChoice, t: (key, params) => onboardingText(locale, key, params) }}>{children}</Context.Provider>;
}

export function OnboardingLanguageProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(Context);
  return inherited ? children : <LanguageProvider>{children}</LanguageProvider>;
}

export function useOnboardingLanguage() {
  const context = useContext(Context);
  if (!context) throw new Error('Onboarding content requires OnboardingLanguageProvider');
  return context;
}

export function OnboardingLanguageSwitcher({ onBeforeChange }: { onBeforeChange?: () => void } = {}) {
  const { locale, automaticLocale, choice, setChoice, t } = useOnboardingLanguage();
  return <label className={styles.languageControl}>
    <Globe size={14} aria-hidden="true" />
    <span>{ONBOARDING_LANGUAGE_NAMES[locale]}</span>
    <ChevronDown size={12} aria-hidden="true" />
    <select aria-label={t('language')} value={choice} onChange={event => { onBeforeChange?.(); setChoice(event.target.value as Choice); }}>
      <option value="auto">{t('automatic')} · {ONBOARDING_LANGUAGE_NAMES[automaticLocale]}</option>
      {ONBOARDING_LOCALES.map(language => <option key={language} value={language} lang={language}>{ONBOARDING_LANGUAGE_NAMES[language]}</option>)}
    </select>
  </label>;
}

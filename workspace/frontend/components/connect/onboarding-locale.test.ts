import { describe, expect, it } from 'vitest';
import { matchOnboardingLocale, resolveOnboardingLocale } from './onboarding-locale';
import { onboardingMessages, onboardingText, ONBOARDING_LOCALES } from './onboarding-messages';

describe('onboarding language preference', () => {
  const detectedWorkspace = { workspaceLocale: 'en-US', workspaceExplicit: false };

  it.each([
    ['en-GB', 'en-US'], ['zh-SG', 'zh-CN'], ['es-MX', 'es-ES'],
    ['fr-CA', 'fr-FR'], ['ja', 'ja-JP'], ['pt-BR', null],
  ])('matches the supported language of %s', (tag, expected) => {
    expect(matchOnboardingLocale(tag)).toBe(expected);
  });

  it('keeps a saved onboarding choice ahead of workspace and browser preferences', () => {
    expect(resolveOnboardingLocale({ choice: 'ja-JP', workspaceLocale: 'zh-CN', workspaceExplicit: true, browserLanguages: ['fr-CA'] })).toBe('ja-JP');
  });

  it('honors an explicitly chosen workspace language', () => {
    expect(resolveOnboardingLocale({ choice: 'auto', workspaceLocale: 'zh-CN', workspaceExplicit: true, browserLanguages: ['es-MX'] })).toBe('zh-CN');
  });

  it('detects the first supported browser preference, including languages the rest of the app does not yet ship', () => {
    expect(resolveOnboardingLocale({ ...detectedWorkspace, browserLanguages: ['pt-BR', 'fr-CA', 'es-ES'] })).toBe('fr-FR');
    expect(resolveOnboardingLocale({ ...detectedWorkspace, browserLanguages: ['ja-JP', 'en-US'] })).toBe('ja-JP');
  });

  it('restores detection with Automatic and ignores invalid saved preferences', () => {
    for (const choice of ['auto', 'unknown', null]) {
      expect(resolveOnboardingLocale({ ...detectedWorkspace, choice, browserLanguages: ['es-MX'] })).toBe('es-ES');
    }
  });

  it('falls back to the known workspace language, then English', () => {
    expect(resolveOnboardingLocale({ workspaceLocale: 'zh-CN', workspaceExplicit: false, browserLanguages: ['de-DE'] })).toBe('zh-CN');
    expect(resolveOnboardingLocale({ workspaceLocale: 'unknown', workspaceExplicit: false })).toBe('en-US');
  });
});

describe('complete onboarding translations', () => {
  it('supplies every message in all five languages with the same interpolation fields', () => {
    expect(ONBOARDING_LOCALES).toHaveLength(5);
    for (const [key, translations] of Object.entries(onboardingMessages)) {
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      expect(translations, key).toHaveLength(5);
      for (const translation of translations) {
        expect(translation.trim(), key).not.toBe('');
        expect(placeholders(translation), key).toEqual(placeholders(translations[0]));
      }
    }
  });

  it('translates the main story and approval states and interpolates accessible progress in every language', () => {
    for (const locale of ONBOARDING_LOCALES) {
      expect(onboardingText(locale, 'progress', { percent: 42 })).toContain('42');
      expect(onboardingText(locale, 'resultFile', { file: 'launch.html' })).toContain('launch.html');
      if (locale !== 'en-US') {
        for (const key of ['introTitle', 'stageWait', 'approvalTitle', 'approvedBy', 'documentBody'] as const) {
          expect(onboardingText(locale, key)).not.toBe(onboardingText('en-US', key));
        }
      }
    }
  });
});

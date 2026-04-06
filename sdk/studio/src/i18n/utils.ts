import i18n from 'i18next';
import { SUPPORTED_LANGUAGES, SupportedLanguage, LANGUAGE_STORAGE_KEY } from './config';

/**
 * Check if a language is supported
 */
export const isLanguageSupported = (language: string): language is SupportedLanguage => {
    return language in SUPPORTED_LANGUAGES;
};

/**
 * Get current language (with fallback to 'en' if not supported)
 */
export const getCurrentLanguage = (): SupportedLanguage => {
    const lang = i18n.language;

    // Check if exact match exists
    if (lang && isLanguageSupported(lang)) {
        return lang;
    }

    // Try language code without region (e.g., 'en' from 'en-US')
    if (lang) {
        const langCode = lang.split('-')[0];
        if (isLanguageSupported(langCode)) {
            return langCode;
        }
    }

    // Fallback to default
    return 'en';
};

/**
 * Change language
 */
export const changeLanguage = async (language: SupportedLanguage): Promise<void> => {
    await i18n.changeLanguage(language);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
};

/**
 * Get language display name
 */
export const getLanguageName = (language: SupportedLanguage, native = false): string => {
    const lang = SUPPORTED_LANGUAGES[language];
    if (!lang) {
        return native ? 'English' : 'English';
    }
    return native ? lang.nativeName : lang.name;
};

/**
 * Get language flag emoji
 */
export const getLanguageFlag = (language: SupportedLanguage): string => {
    const lang = SUPPORTED_LANGUAGES[language];
    if (!lang) {
        return SUPPORTED_LANGUAGES['en'].flag;
    }
    return lang.flag;
};

/**
 * Get browser language preference
 */
export const getBrowserLanguage = (): SupportedLanguage => {
    const browserLang = navigator.language;

    // Try exact match first
    if (isLanguageSupported(browserLang)) {
        return browserLang;
    }

    // Try language code without region (e.g., 'zh' from 'zh-TW')
    const langCode = browserLang.split('-')[0];
    if (isLanguageSupported(langCode)) {
        return langCode;
    }

    // Try with region code (e.g., 'zh-CN' from 'zh')
    const langWithRegion = `${langCode}-CN`;
    if (isLanguageSupported(langWithRegion)) {
        return langWithRegion;
    }

    // Fallback to default language
    return 'en';
};

/**
 * Format date according to current language
 */
export const formatDate = (date: Date | string, options?: Intl.DateTimeFormatOptions): string => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const currentLang = getCurrentLanguage();

    return new Intl.DateTimeFormat(currentLang, options).format(dateObj);
};

/**
 * Format number according to current language
 */
export const formatNumber = (num: number, options?: Intl.NumberFormatOptions): string => {
    const currentLang = getCurrentLanguage();
    return new Intl.NumberFormat(currentLang, options).format(num);
};

/**
 * Format relative time (e.g., "2 hours ago")
 */
export const formatRelativeTime = (date: Date | string): string => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000);

    const currentLang = getCurrentLanguage();
    const rtf = new Intl.RelativeTimeFormat(currentLang, { numeric: 'auto' });

    if (diffInSeconds < 60) {
        return rtf.format(-diffInSeconds, 'second');
    } else if (diffInSeconds < 3600) {
        return rtf.format(-Math.floor(diffInSeconds / 60), 'minute');
    } else if (diffInSeconds < 86400) {
        return rtf.format(-Math.floor(diffInSeconds / 3600), 'hour');
    } else if (diffInSeconds < 2592000) {
        return rtf.format(-Math.floor(diffInSeconds / 86400), 'day');
    } else if (diffInSeconds < 31536000) {
        return rtf.format(-Math.floor(diffInSeconds / 2592000), 'month');
    } else {
        return rtf.format(-Math.floor(diffInSeconds / 31536000), 'year');
    }
};

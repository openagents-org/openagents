import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { Namespace, SupportedLanguage } from '@/i18n/config';
import { changeLanguage, getCurrentLanguage } from '@/i18n/utils';

/**
 * Custom hook for i18n with additional utilities
 */
export const useI18n = (ns?: Namespace | Namespace[]) => {
    const { t, i18n } = useTranslation(ns);
    const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>(
        getCurrentLanguage()
    );

    // Update current language when i18n language changes
    useEffect(() => {
        const handleLanguageChange = (lng: string) => {
            setCurrentLanguage(lng as SupportedLanguage);
        };

        i18n.on('languageChanged', handleLanguageChange);

        return () => {
            i18n.off('languageChanged', handleLanguageChange);
        };
    }, [i18n]);

    // Change language function
    const switchLanguage = useCallback(
        async (language: SupportedLanguage) => {
            await changeLanguage(language);
        },
        []
    );

    // Check if current language is a specific language
    const isLanguage = useCallback(
        (language: SupportedLanguage) => {
            return currentLanguage === language;
        },
        [currentLanguage]
    );

    return {
        t,
        i18n,
        currentLanguage,
        switchLanguage,
        isLanguage,
        isEnglish: currentLanguage === 'en',
        isChinese: currentLanguage === 'zh-CN',
    };
};

/**
 * Hook to get translation function for a specific namespace
 */
export const useNamespace = (ns: Namespace) => {
    const { t } = useTranslation(ns);
    return t;
};

/**
 * Hook to get common translations
 */
export const useCommonTranslation = () => {
    return useNamespace('common');
};

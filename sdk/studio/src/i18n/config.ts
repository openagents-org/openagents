// Supported languages configuration
export const SUPPORTED_LANGUAGES = {
    en: {
        name: 'English',
        nativeName: 'English',
        flag: '🇺🇸',
    },
    'zh-CN': {
        name: 'Chinese (Simplified)',
        nativeName: '简体中文',
        flag: '🇨🇳',
    },
    ja: {
        name: 'Japanese',
        nativeName: '日本語',
        flag: '🇯🇵',
    },
    ko: {
        name: 'Korean',
        nativeName: '한국어',
        flag: '🇰🇷',
    },
} as const;

// Type for supported language codes
export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// Storage key for persisting language preference
export const LANGUAGE_STORAGE_KEY = 'i18n-language';

// Fallback language when detection fails
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

// All namespaces used in the application
export const NAMESPACES = [
    'common',
    'auth',
    'messaging',
    'documents',
    'wiki',
    'forum',
    'feed',
    'mcp',
    'profile',
    'network',
    'layout',
    'errors',
    'validation',
    'project',
    'artifact',
    'llmlogs',
    'serviceAgent',
    'events',
    'agentWorld',
    'readme',
    'admin',
    'onboarding',
] as const;

// Type for namespaces
export type Namespace = (typeof NAMESPACES)[number];

// Default namespace
export const DEFAULT_NAMESPACE: Namespace = 'common';

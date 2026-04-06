import { TFunction } from 'i18next';
import { Namespace } from './config';

// Type-safe translation function
export type TranslationFunction = TFunction<Namespace, undefined>;

// Language change event
export interface LanguageChangeEvent {
    language: string;
    previousLanguage: string;
}

// Translation key types (will be extended as we add more translations)
export interface CommonTranslations {
    // Buttons
    'button.save': string;
    'button.cancel': string;
    'button.delete': string;
    'button.edit': string;
    'button.create': string;
    'button.submit': string;
    'button.close': string;
    'button.confirm': string;
    'button.back': string;
    'button.next': string;

    // Common labels
    'label.name': string;
    'label.email': string;
    'label.password': string;
    'label.search': string;
    'label.filter': string;
    'label.sort': string;

    // Status
    'status.loading': string;
    'status.success': string;
    'status.error': string;
    'status.warning': string;
}

// Extend this as we add more namespaces
export interface Translations {
    common: CommonTranslations;
    // auth: AuthTranslations;
    // messaging: MessagingTranslations;
    // ... other namespaces
}

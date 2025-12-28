import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
    FALLBACK_LANGUAGE,
    NAMESPACES,
    DEFAULT_NAMESPACE,
    LANGUAGE_STORAGE_KEY,
} from './config';

// Import translation files
import commonEN from './locales/en/common.json';
import authEN from './locales/en/auth.json';
import messagingEN from './locales/en/messaging.json';
import documentsEN from './locales/en/documents.json';
import wikiEN from './locales/en/wiki.json';
import forumEN from './locales/en/forum.json';
import feedEN from './locales/en/feed.json';
import mcpEN from './locales/en/mcp.json';
import profileEN from './locales/en/profile.json';
import networkEN from './locales/en/network.json';
import layoutEN from './locales/en/layout.json';
import errorsEN from './locales/en/errors.json';
import validationEN from './locales/en/validation.json';
import projectEN from './locales/en/project.json';
import artifactEN from './locales/en/artifact.json';
import llmlogsEN from './locales/en/llmlogs.json';
import serviceAgentEN from './locales/en/serviceAgent.json';
import eventsEN from './locales/en/events.json';
import agentWorldEN from './locales/en/agentWorld.json';
import readmeEN from './locales/en/readme.json';
import adminEN from './locales/en/admin.json';
import onboardingEN from './locales/en/onboarding.json';

import commonZH from './locales/zh-CN/common.json';
import authZH from './locales/zh-CN/auth.json';
import messagingZH from './locales/zh-CN/messaging.json';
import documentsZH from './locales/zh-CN/documents.json';
import wikiZH from './locales/zh-CN/wiki.json';
import forumZH from './locales/zh-CN/forum.json';
import feedZH from './locales/zh-CN/feed.json';
import mcpZH from './locales/zh-CN/mcp.json';
import profileZH from './locales/zh-CN/profile.json';
import networkZH from './locales/zh-CN/network.json';
import layoutZH from './locales/zh-CN/layout.json';
import errorsZH from './locales/zh-CN/errors.json';
import validationZH from './locales/zh-CN/validation.json';
import projectZH from './locales/zh-CN/project.json';
import artifactZH from './locales/zh-CN/artifact.json';
import llmlogsZH from './locales/zh-CN/llmlogs.json';
import serviceAgentZH from './locales/zh-CN/serviceAgent.json';
import eventsZH from './locales/zh-CN/events.json';
import agentWorldZH from './locales/zh-CN/agentWorld.json';
import readmeZH from './locales/zh-CN/readme.json';
import adminZH from './locales/zh-CN/admin.json';
import onboardingZH from './locales/zh-CN/onboarding.json';

import commonJA from './locales/ja/common.json';
import authJA from './locales/ja/auth.json';
import messagingJA from './locales/ja/messaging.json';
import documentsJA from './locales/ja/documents.json';
import wikiJA from './locales/ja/wiki.json';
import forumJA from './locales/ja/forum.json';
import feedJA from './locales/ja/feed.json';
import mcpJA from './locales/ja/mcp.json';
import profileJA from './locales/ja/profile.json';
import networkJA from './locales/ja/network.json';
import layoutJA from './locales/ja/layout.json';
import errorsJA from './locales/ja/errors.json';
import validationJA from './locales/ja/validation.json';
import projectJA from './locales/ja/project.json';
import artifactJA from './locales/ja/artifact.json';
import llmlogsJA from './locales/ja/llmlogs.json';
import serviceAgentJA from './locales/ja/serviceAgent.json';
import eventsJA from './locales/ja/events.json';
import agentWorldJA from './locales/ja/agentWorld.json';
import readmeJA from './locales/ja/readme.json';
import adminJA from './locales/ja/admin.json';
import onboardingJA from './locales/ja/onboarding.json';

import commonKO from './locales/ko/common.json';
import authKO from './locales/ko/auth.json';
import messagingKO from './locales/ko/messaging.json';
import documentsKO from './locales/ko/documents.json';
import wikiKO from './locales/ko/wiki.json';
import forumKO from './locales/ko/forum.json';
import feedKO from './locales/ko/feed.json';
import mcpKO from './locales/ko/mcp.json';
import profileKO from './locales/ko/profile.json';
import networkKO from './locales/ko/network.json';
import layoutKO from './locales/ko/layout.json';
import errorsKO from './locales/ko/errors.json';
import validationKO from './locales/ko/validation.json';
import projectKO from './locales/ko/project.json';
import artifactKO from './locales/ko/artifact.json';
import llmlogsKO from './locales/ko/llmlogs.json';
import serviceAgentKO from './locales/ko/serviceAgent.json';
import eventsKO from './locales/ko/events.json';
import agentWorldKO from './locales/ko/agentWorld.json';
import readmeKO from './locales/ko/readme.json';
import adminKO from './locales/ko/admin.json';
import onboardingKO from './locales/ko/onboarding.json';

// Configure language detector
const languageDetectorOptions = {
    // Order of detection methods
    order: ['querystring', 'localStorage', 'navigator'],

    // Keys to lookup language from
    lookupQuerystring: 'lang',
    lookupLocalStorage: LANGUAGE_STORAGE_KEY,

    // Cache user language
    caches: ['localStorage'],

    // Optional: exclude certain languages from being detected
    excludeCacheFor: ['cimode'],
};

// Initialize i18next
i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        // Resources
        resources: {
            en: {
                common: commonEN,
                auth: authEN,
                messaging: messagingEN,
                documents: documentsEN,
                wiki: wikiEN,
                forum: forumEN,
                feed: feedEN,
                mcp: mcpEN,
                profile: profileEN,
                network: networkEN,
                layout: layoutEN,
                errors: errorsEN,
                validation: validationEN,
                project: projectEN,
                artifact: artifactEN,
                llmlogs: llmlogsEN,
                serviceAgent: serviceAgentEN,
                events: eventsEN,
                agentWorld: agentWorldEN,
                readme: readmeEN,
                admin: adminEN,
                onboarding: onboardingEN,
            },
            'zh-CN': {
                common: commonZH,
                auth: authZH,
                messaging: messagingZH,
                documents: documentsZH,
                wiki: wikiZH,
                forum: forumZH,
                feed: feedZH,
                mcp: mcpZH,
                profile: profileZH,
                network: networkZH,
                layout: layoutZH,
                errors: errorsZH,
                validation: validationZH,
                project: projectZH,
                artifact: artifactZH,
                llmlogs: llmlogsZH,
                serviceAgent: serviceAgentZH,
                events: eventsZH,
                agentWorld: agentWorldZH,
                readme: readmeZH,
                admin: adminZH,
                onboarding: onboardingZH,
            },
            ja: {
                common: commonJA,
                auth: authJA,
                messaging: messagingJA,
                documents: documentsJA,
                wiki: wikiJA,
                forum: forumJA,
                feed: feedJA,
                mcp: mcpJA,
                profile: profileJA,
                network: networkJA,
                layout: layoutJA,
                errors: errorsJA,
                validation: validationJA,
                project: projectJA,
                artifact: artifactJA,
                llmlogs: llmlogsJA,
                serviceAgent: serviceAgentJA,
                events: eventsJA,
                agentWorld: agentWorldJA,
                readme: readmeJA,
                admin: adminJA,
                onboarding: onboardingJA,
            },
            ko: {
                common: commonKO,
                auth: authKO,
                messaging: messagingKO,
                documents: documentsKO,
                wiki: wikiKO,
                forum: forumKO,
                feed: feedKO,
                mcp: mcpKO,
                profile: profileKO,
                network: networkKO,
                layout: layoutKO,
                errors: errorsKO,
                validation: validationKO,
                project: projectKO,
                artifact: artifactKO,
                llmlogs: llmlogsKO,
                serviceAgent: serviceAgentKO,
                events: eventsKO,
                agentWorld: agentWorldKO,
                readme: readmeKO,
                admin: adminKO,
                onboarding: onboardingKO,
            },
        },

        // Language settings - DO NOT set lng here, let language detector handle it
        fallbackLng: FALLBACK_LANGUAGE,

        // Namespace settings
        ns: NAMESPACES,
        defaultNS: DEFAULT_NAMESPACE,

        // Language detector options
        detection: languageDetectorOptions,

        // Interpolation settings
        interpolation: {
            escapeValue: false, // React already escapes values
        },

        // React specific options
        react: {
            useSuspense: false, // Set to true if you want to use Suspense
        },

        // Debug mode (disable in production)
        debug: process.env.NODE_ENV === 'development',

        // Return empty string for missing keys instead of key name
        returnEmptyString: false,

        // Return null for missing keys
        returnNull: false,
    });

export default i18n;

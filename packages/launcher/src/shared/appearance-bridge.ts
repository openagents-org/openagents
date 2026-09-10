/**
 * The look-and-feel the launcher hands to the workspace it hosts.
 *
 * They are one application in one window, so they cannot disagree about
 * whether it is dark or what language it speaks. Left alone they would: the
 * two keep their choice under different storage keys, apply it by different
 * means (a data attribute here, a class there), and even spell the languages
 * differently. They look consistent today only because both happened to guess
 * the same thing from the OS.
 *
 * What is deliberately NOT shared: the accent colour, the skin, the UI scale.
 * Those are the launcher's own visual system; the workspace has its own design
 * language, and repainting it in the launcher's would mean editing its design
 * tokens — exactly the kind of divergence that stops the web code being reused
 * as-is.
 */

/** Both apps offer the same three, and both understand "follow the OS". */
export type ThemeMode = "light" | "dark" | "system"

/** The launcher speaks `zh`; the workspace spells the same language `zh-CN`. */
export type LauncherLanguage = "en" | "zh"
export type WorkspaceLocale = "en-US" | "zh-CN"

export interface Appearance {
  theme: ThemeMode
  language: LauncherLanguage
}

const LOCALE_BY_LANGUAGE: Record<LauncherLanguage, WorkspaceLocale> = {
  en: "en-US",
  zh: "zh-CN",
}

export function toWorkspaceLocale(language: string): WorkspaceLocale {
  return LOCALE_BY_LANGUAGE[language as LauncherLanguage] ?? "en-US"
}

export function toLauncherLanguage(locale: string): LauncherLanguage {
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en"
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system"
}

/**
 * Where next-themes keeps the choice. The workspace uses its defaults, so this
 * is the key its provider reads on start-up — which is why the preload writes
 * it before any page script runs: reading it a frame late is a flash of the
 * wrong theme, and in a dark app that is the one thing everybody notices.
 */
export const WORKSPACE_THEME_KEY = "theme"

/** Where the workspace persists its language (see its lib/i18n/locales). */
export const WORKSPACE_LOCALE_KEY = "oa_locale"

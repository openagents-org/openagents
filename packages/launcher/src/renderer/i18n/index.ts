import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from "i18next-browser-languagedetector"

// Each per-feature JSON file under locales/<lng>/ becomes one top-level key in
// that language's `translation` namespace, named after the file (e.g.
// locales/en/agents.json → t("agents.*")). Dropping a new <feature>.json into
// both locale folders is all that's needed to add a translated area — no edits
// here. Glob is resolved at build time by Vite (and Vitest).
const enModules = import.meta.glob("./locales/en/*.json", { eager: true })
const zhModules = import.meta.glob("./locales/zh/*.json", { eager: true })

function buildBundle(
  modules: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const path in modules) {
    const key = path.split("/").pop()!.replace(/\.json$/, "")
    const mod = modules[path] as { default?: unknown }
    out[key] = mod.default ?? mod
  }
  return out
}

const en = buildBundle(enModules)
const zh = buildBundle(zhModules)

// Supported UI languages. `value` is the i18next language code; `label` is the
// endonym shown in the language picker (always written in its own language).
export const SUPPORTED_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["value"]

export const STORAGE_KEY = "launcher:language"

export const resources = {
  en: { translation: en },
  zh: { translation: zh },
} as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.value),
    // Treat region variants (e.g. zh-CN, zh-TW) as their base language.
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: STORAGE_KEY,
      caches: ["localStorage"],
    },
    returnNull: false,
  })

// Keep <html lang> in sync so the OS / accessibility tools and CSS :lang()
// selectors see the active language.
function applyDocumentLang(lng: string): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng
  }
}

// Mirror the language into main's settings store. Main owns the OS
// notifications and the tray menu but can't read i18next's localStorage, so
// without this an update toast stays English for a user who picked 简体中文.
function syncLanguageToMain(lng: string): void {
  try {
    void window.api?.setSetting?.("language", lng)
  } catch {}
}

applyDocumentLang(i18n.resolvedLanguage ?? i18n.language)
syncLanguageToMain(i18n.resolvedLanguage ?? i18n.language)
i18n.on("languageChanged", (lng: string) => {
  applyDocumentLang(lng)
  syncLanguageToMain(lng)
})

export function changeLanguage(lng: LanguageCode): Promise<unknown> {
  return i18n.changeLanguage(lng)
}

export default i18n

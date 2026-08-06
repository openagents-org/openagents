// ── Main-process strings ──
//
// The renderer's i18next bundle lives behind localStorage and Vite's glob
// import, neither of which main can reach. Main only needs a handful of strings
// (OS notifications, tray menu), so this is a deliberately tiny lookup rather
// than a second i18next instance.
//
// Language resolution: the renderer pushes its active UI language here whenever
// it changes (and once on startup) so an OS toast matches the language the user
// picked in Settings. Before that arrives — e.g. a notification fired during
// early startup — we fall back to the OS locale.
import { app } from "electron"

export type MainLanguage = "en" | "zh"

const STRINGS: Record<MainLanguage, Record<string, string>> = {
  en: {
    updateReadyTitle: "Update ready",
    updateReadyBody:
      "OpenAgents Launcher v{{version}} is downloaded. Click “Restart & install” to apply it.",
    updateAvailableTitle: "Update available",
    updateAvailableBody:
      "OpenAgents Launcher v{{version}} is available. Open Settings → Updates to download it.",
    trayRestartToUpdate: "Restart to update (v{{version}})",
    agentUpdatesTitle: "{{count}} agent updates available",
    agentUpdatesTitleOne: "Update available for {{name}}",
    agentUpdatesBody: "{{names}} — open the marketplace to upgrade.",
    startupFailedTitle: "OpenAgents Launcher could not start",
    startupFailedBody:
      "{{message}}\n\nThe full log is at:\n{{log}}\n\nPlease send it to support if this keeps happening.",
  },
  zh: {
    updateReadyTitle: "更新已就绪",
    updateReadyBody:
      "OpenAgents 启动器 v{{version}} 已下载完成，点击「重启并安装」立即更新。",
    updateAvailableTitle: "发现新版本",
    updateAvailableBody:
      "OpenAgents 启动器 v{{version}} 可用，前往「设置 → 更新」下载。",
    trayRestartToUpdate: "重启并更新（v{{version}}）",
    agentUpdatesTitle: "{{count}} 个智能体可更新",
    agentUpdatesTitleOne: "{{name}} 有新版本",
    agentUpdatesBody: "{{names}} — 前往应用市场查看并升级。",
    startupFailedTitle: "OpenAgents 启动器无法启动",
    startupFailedBody:
      "{{message}}\n\n完整日志：\n{{log}}\n\n如果反复出现，请把日志发给我们。",
  },
}

let _language: MainLanguage | null = null

function detectFromLocale(): MainLanguage {
  try {
    const locale = (app?.getLocale?.() || "").toLowerCase()
    if (locale.startsWith("zh")) return "zh"
  } catch {}
  return "en"
}

/** Accepts any i18next code ("zh", "zh-CN", "en-US") and narrows it. */
export function setMainLanguage(lng: unknown): void {
  if (typeof lng !== "string" || !lng) return
  _language = lng.toLowerCase().startsWith("zh") ? "zh" : "en"
}

export function getMainLanguage(): MainLanguage {
  return _language ?? detectFromLocale()
}

/** Look up `key`, substituting {{name}} placeholders from `vars`. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const lang = getMainLanguage()
  const template = STRINGS[lang][key] ?? STRINGS.en[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  )
}

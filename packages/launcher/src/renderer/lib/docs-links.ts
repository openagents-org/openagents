/**
 * Chapters of the OpenAgents user guide the app links to. The guide is written
 * in English and Chinese, at /docs/en/… and /docs/zh/…; the app's other
 * languages (none yet) get English.
 */
const DOCS_BASE = "https://openagents.org/docs"

export const DOCS_PAGES = {
  overview: "getting-started/overview",
  // "This computer" versus a workspace: which side does what.
  workspaceVsLauncher: "getting-started/workspace-vs-launcher",
  managingAgents: "launcher/managing-agents",
} as const

export type DocsPage = keyof typeof DOCS_PAGES

export function docsUrl(page: DocsPage, language: string | undefined): string {
  const lang = (language || "").toLowerCase().startsWith("zh") ? "zh" : "en"
  return `${DOCS_BASE}/${lang}/${DOCS_PAGES[page]}`
}

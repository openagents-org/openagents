/**
 * The OpenAgents user guide. It is written in English and Chinese, at
 * /docs/en/… and /docs/zh/…; the app's other languages (none yet) get English.
 * The front page leads to every chapter.
 */
const DOCS_BASE = "https://openagents.org/docs"
const DOCS_HOME = "getting-started/overview"

export function docsUrl(language: string | undefined): string {
  const lang = (language || "").toLowerCase().startsWith("zh") ? "zh" : "en"
  return `${DOCS_BASE}/${lang}/${DOCS_HOME}`
}

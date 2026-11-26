/**
 * Links into the OpenAgents user guide, for the help entry in the user menu
 * and the pages that point at their own chapter.
 *
 * The guide is public, so the hosted docs are the default for self-hosted
 * builds too; NEXT_PUBLIC_DOCS_URL points them at a mirror with the same
 * layout (it is inlined at build time, like every NEXT_PUBLIC_* value).
 */
const DEFAULT_DOCS_BASE = 'https://openagents.org/docs';

export const DOCS_BASE = (process.env.NEXT_PUBLIC_DOCS_URL || DEFAULT_DOCS_BASE).replace(/\/+$/, '');

/** Chapters of the guide the product links to, by what the user is doing. */
export const DOCS_PAGES = {
  overview: 'getting-started/overview',
  installation: 'getting-started/installation',
  // "This computer" (the desktop app) versus a workspace: which does what.
  workspaceVsLauncher: 'getting-started/workspace-vs-launcher',
  workspaceGettingStarted: 'workspace/getting-started',
  managingAgents: 'launcher/managing-agents',
} as const;

export type DocsPage = keyof typeof DOCS_PAGES;

/** The guide is written in English and Chinese; other languages get English. */
function docsLanguage(locale: string): 'en' | 'zh' {
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function docsUrl(page: DocsPage, locale = 'en'): string {
  return `${DOCS_BASE}/${docsLanguage(locale)}/${DOCS_PAGES[page]}`;
}

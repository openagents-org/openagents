/**
 * The OpenAgents user guide, for the help entry in the user menu.
 *
 * The guide is public, so the hosted docs are the default for self-hosted
 * builds too; NEXT_PUBLIC_DOCS_URL points them at a mirror with the same
 * layout (it is inlined at build time, like every NEXT_PUBLIC_* value).
 */
const DEFAULT_DOCS_BASE = 'https://openagents.org/docs';

export const DOCS_BASE = (process.env.NEXT_PUBLIC_DOCS_URL || DEFAULT_DOCS_BASE).replace(/\/+$/, '');

/** The guide's front page, which leads to every chapter. */
const DOCS_HOME = 'getting-started/overview';

/** The guide is written in English and Chinese; other languages get English. */
export function docsUrl(locale = 'en'): string {
  const lang = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  return `${DOCS_BASE}/${lang}/${DOCS_HOME}`;
}

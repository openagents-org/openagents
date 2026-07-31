/** `openagents:mkt-bot` / `human:lixiang` → the bare name shown in entry meta. */
export function knowledgeAuthorName(value: string | null): string {
  if (!value) return '';
  return value.replace(/^(openagents:|human:|system:)/, '');
}

/**
 * Entries almost always open with an `# H1` repeating their own title, which
 * the article header already renders. Drop that one leading heading (and the
 * blank line after it) so the title isn't printed twice.
 */
export function stripLeadingTitle(content: string, title: string): string {
  const match = content.match(/^\s*#{1,2}[ \t]+(.+?)[ \t]*(?:\n|$)/);
  if (!match) return content;
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalize(match[1]) !== normalize(title)) return content;
  return content.slice(match[0].length).replace(/^\n+/, '');
}

/** Compact relative time for knowledge rows and the entry header. */
export function knowledgeTimeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

import type { AgentCatalogEntry } from '@/lib/types';

const DISPLAY_NAMES: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude',
  deepseek: 'DeepSeek',
};

/** Short product names for the picker and its configuration view. */
export function agentDisplayName(entry: Pick<AgentCatalogEntry, 'name' | 'label'>): string {
  return DISPLAY_NAMES[entry.name] || entry.label;
}

/** Keep the spotlight current when an older backend supplies the catalog. */
export function agentDisplayTagline(entry: Pick<AgentCatalogEntry, 'name' | 'tagline' | 'description'>): string {
  if (entry.name === 'codex') return 'GPT-6 powered engineering from OpenAI.';
  return entry.tagline || entry.description;
}

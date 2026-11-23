'use client';

import { ExternalLink } from 'lucide-react';
import { useT } from '@/lib/i18n';

/**
 * Where each provider hands out API keys, for agents whose key comes from one
 * place. DeepSeek has no account sign-in at all, so this is its whole setup.
 */
export const API_KEY_PAGES: Record<string, { url: string; provider: string }> = {
  deepseek: { url: 'https://platform.deepseek.com/api_keys', provider: 'DeepSeek' },
  claude: { url: 'https://console.anthropic.com/settings/keys', provider: 'Anthropic' },
  codex: { url: 'https://platform.openai.com/api-keys', provider: 'OpenAI' },
  cursor: { url: 'https://cursor.com/dashboard?tab=integrations', provider: 'Cursor' },
  gemini: { url: 'https://aistudio.google.com/apikey', provider: 'Google AI Studio' },
};

/** "Don't have a key? Get one from DeepSeek ↗", or nothing for other agents. */
export function AgentSetupKeyLink({ type }: { type: string }) {
  const t = useT();
  const page = API_KEY_PAGES[type];
  if (!page) return null;
  return <p data-testid="agent-setup-key-link" className="text-xs text-muted-foreground">
    {t('agentSetup.getKeyPrompt')}{' '}
    <a href={page.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
      {t('agentSetup.getKeyLink', { provider: page.provider })}<ExternalLink className="size-3" />
    </a>
  </p>;
}

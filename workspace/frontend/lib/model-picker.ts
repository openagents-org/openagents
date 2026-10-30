/**
 * Whether an agent's curated model list applies to the endpoint it calls.
 *
 * A registry model list names one vendor's ids. An agent pointed at a relay or
 * at another vendor's endpoint is served a different set, so picking from the
 * list saved an id that endpoint rejects on the agent's next task.
 */

/** Providers whose catalog entry has no base_url: their SDK default is this host. */
const SDK_DEFAULT_HOSTS: Record<string, string> = {
  openai: 'api.openai.com',
  anthropic: 'api.anthropic.com',
};

/** Lowercased hostname of a URL, also when written without a scheme; null for nothing. */
export function hostOf(url: string | null | undefined): string | null {
  const raw = (url || '').trim();
  if (!raw) return null;
  for (const candidate of [raw, `http://${raw}`]) {
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      if (host) return host;
    } catch {
      // try the next form
    }
  }
  return null;
}

export function curatedModelsFitEndpoint({
  baseUrlHost,
  modelsProvider,
  providers,
}: {
  /** From the node roster; absent when the agent uses its CLI's default endpoint. */
  baseUrlHost: string | null | undefined;
  /** The provider the list comes from; null for a list the agent's vendor curates. */
  modelsProvider: string | null | undefined;
  providers: { name: string; base_url?: string | null }[];
}): boolean {
  const host = (baseUrlHost || '').trim().toLowerCase();
  if (!host) return true;
  // A vendor-curated list (Copilot, Cursor, OpenCode Zen…) is for that vendor's
  // own service, which no base URL override points at.
  if (!modelsProvider) return false;
  const provider = providers.find((p) => p.name === modelsProvider);
  const providerHost = hostOf(provider?.base_url) || SDK_DEFAULT_HOSTS[modelsProvider] || null;
  return providerHost === host;
}

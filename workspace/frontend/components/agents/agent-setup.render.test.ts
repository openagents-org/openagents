/**
 * Server-renders the add-agent gallery with an empty catalog. An empty catalog
 * means the load has not landed yet or failed — the gallery used to say
 * `Nothing matches “”.` for both, blaming a search nobody had typed, and
 * offered no way to load the catalog again.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { messages as en } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentSetupApi, type CatalogState } from './agent-setup';

vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => translate(en, en, 'en-US', key, params),
}));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));

const node = { nodeId: 'n1', name: 'LAPTOP-1', runtimes: [], agents: [] } as unknown as WorkspaceNode;
const api = {} as AgentSetupApi;

function render(catalogState?: CatalogState) {
  return renderToString(createElement(AgentSetup, {
    node, catalog: [], catalogState, api, onBack: () => {}, onChanged: () => {},
  }));
}

describe('AgentSetup gallery with an empty catalog', () => {
  it('says the list is loading while it loads', () => {
    const html = render({ status: 'loading', retry: () => {} });
    expect(html).toContain(en.connect.marketLoading);
    expect(html).not.toContain('Nothing matches');
  });

  it('says the list failed to load, with a retry', () => {
    const html = render({ status: 'error', retry: () => {} });
    expect(html).toContain('the agent list');
    expect(html).toContain(`>${en.connect.marketRetry}<`);
    expect(html).not.toContain('Nothing matches');
  });

  it('never quotes an empty search', () => {
    const html = render();
    expect(html).not.toContain('“”');
    expect(html).toContain(en.connect.marketNoneInCategory);
  });
});

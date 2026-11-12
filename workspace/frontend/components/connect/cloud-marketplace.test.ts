// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectAgentView } from './connect-agent-view';

const api = vi.hoisted(() => ({
  getAgentCatalog: vi.fn(), getCloudProviders: vi.fn(), listCloudAgents: vi.fn(),
  modelProbe: vi.fn(), addCloudAgent: vi.fn(),
  getHostedProviders: vi.fn(() => Promise.resolve([])), listHostedAgents: vi.fn(() => Promise.resolve([])),
  listMyAcentaAgents: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('@/lib/api', () => ({ workspaceApi: api }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  workspace: { workspaceId: 'test-workspace' }, token: 'test-token', agents: [], refreshWorkspace: vi.fn(),
}) }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ openView: vi.fn(), isMobile: false }) }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: () => null }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: null }) }));
vi.mock('@/lib/analytics', () => ({ capture: vi.fn() }));
vi.mock('@/lib/desktop-host', () => ({ desktopHost: () => null }));
vi.mock('@/hooks/use-copy-to-clipboard', () => ({ useCopyToClipboard: () => ({}) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({}) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.getAgentCatalog.mockResolvedValue([]);
  api.getCloudProviders.mockResolvedValue(['perplexity', 'manus', 'tokenpay', 'sensenova'].map((name) => ({ name, label: name, base_url: '', models: [] })));
  api.listCloudAgents.mockResolvedValue([]);
  api.modelProbe.mockReset();
  api.addCloudAgent.mockReset().mockResolvedValue({});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement<{ initialTab: 'cloud' }>(ConnectAgentView, { initialTab: 'cloud' })); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('offers only Acenta on the cloud agents page, not the other cloud providers', () => {
  expect(container.textContent).toContain('connect.cloudMarketplaceTitle');
  for (const name of ['perplexity', 'manus', 'tokenpay', 'sensenova']) {
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes(name))).toBe(false);
  }
});

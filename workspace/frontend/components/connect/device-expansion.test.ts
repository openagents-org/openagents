// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectAgentView } from './connect-agent-view';
import type { WorkspaceNode } from '@/lib/types';

const api = vi.hoisted(() => ({
  getAgentCatalog: vi.fn(), getCloudProviders: vi.fn(), listCloudAgents: vi.fn(),
  listNodes: vi.fn(),
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
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgo: () => 'now' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));


vi.mock('@/components/campaign/campaign-feedback', () => ({
  CampaignConnectHint: () => null, CAMPAIGN_PROMO_AGENT_TYPES: new Set(),
}));
vi.mock('@/components/agents/agent-setup', () => ({
  AgentSetup: ({ node, onBack }: { node: WorkspaceNode; onBack: () => void }) => React.createElement(
    'section', { 'aria-label': `Agent gallery for ${node.name}` },
    React.createElement('button', { onClick: onBack }, 'Back to devices'),
  ),
}));
let root: Root;
let container: HTMLDivElement;
function device(nodeId: string, status = 'online'): WorkspaceNode {
  return { nodeId, name: nodeId, status, hostname: nodeId, deviceType: 'server', os: 'linux',
    launcherVersion: '0.2.198', agents: [], runtimes: [], lastHeartbeatAt: null, createdAt: null };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.getAgentCatalog.mockResolvedValue([]);
  api.getCloudProviders.mockResolvedValue([]);
  api.listCloudAgents.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(nodes: WorkspaceNode[]) {
  api.listNodes.mockResolvedValue(nodes);
  await act(async () => root.render(React.createElement(ConnectAgentView)));
}
function summary(name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
    .find((button) => button.textContent?.includes(name))!;
}
function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
}
function expandedCount() { return container.querySelectorAll('[id^="device-agents-"]').length; }

it('opens the only device and exposes adding an agent immediately, including after gallery Back', async () => {
  await render([device('exp')]);
  expect(summary('exp').getAttribute('aria-expanded')).toBe('true');
  expect(container.textContent).toContain('connect.nodeAddFirstAgentHint');
  await act(async () => button('connect.nodeAddAgent').click());
  expect(container.querySelector('[aria-label="Agent gallery for exp"]')).not.toBeNull();
  await act(async () => button('Back to devices').click());
  expect(summary('exp').getAttribute('aria-expanded')).toBe('true');
  await act(async () => summary('exp').click());
  expect(expandedCount()).toBe(1);
});

it('prefers an online device and keeps one open when switching devices', async () => {
  await render([device('offline', 'offline'), device('online')]);
  expect(summary('online').getAttribute('aria-expanded')).toBe('true');
  expect(summary('offline').getAttribute('aria-expanded')).toBe('false');
  await act(async () => summary('offline').click());
  expect(summary('offline').getAttribute('aria-expanded')).toBe('true');
  expect(summary('online').getAttribute('aria-expanded')).toBe('false');
  expect(expandedCount()).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(summary('offline').getAttribute('aria-expanded')).toBe('true');
});

it('opens another device if the selected device disappears during refresh', async () => {
  await render([device('first'), device('second')]);
  expect(summary('first').getAttribute('aria-expanded')).toBe('true');
  api.listNodes.mockResolvedValue([device('second')]);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(summary('second').getAttribute('aria-expanded')).toBe('true');
  expect(expandedCount()).toBe(1);
});

it('opens a device arriving after an empty list, and works when all devices are offline', async () => {
  await render([]);
  expect(expandedCount()).toBe(0);
  api.listNodes.mockResolvedValue([device('arriving', 'offline')]);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(summary('arriving').getAttribute('aria-expanded')).toBe('true');
  expect(button('connect.nodeAddAgent')).toBeDefined();
});

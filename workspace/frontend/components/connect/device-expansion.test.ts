// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectAgentView, FirstRunOnboarding } from './connect-agent-view';
import type { WorkspaceNode } from '@/lib/types';

const api = vi.hoisted(() => ({
  getAgentCatalog: vi.fn(), getCloudProviders: vi.fn(), listCloudAgents: vi.fn(),
  getHostedProviders: vi.fn(() => Promise.resolve([])), listHostedAgents: vi.fn(() => Promise.resolve([])),
  listNodes: vi.fn(), createPairingCode: vi.fn(), sendSetupEmail: vi.fn(),
}));
const fixture = vi.hoisted(() => ({ connectSetupRequest: null as null | { method: 'desktop' | 'terminal' }, needsFirstDevice: false, mobile: false, idToken: null as string | null, openView: vi.fn() }));
vi.mock('@/lib/account-api', () => ({ sendSetupEmail: api.sendSetupEmail }));
vi.mock('@/lib/api', () => ({ workspaceApi: api }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  workspace: { workspaceId: 'test-workspace', slug: 'test-workspace', needsFirstDevice: fixture.needsFirstDevice }, token: 'test-token', agents: [], refreshWorkspace: vi.fn(),
}) }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ openView: fixture.openView, connectSetupRequest: fixture.connectSetupRequest, isMobile: false }) }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: () => React.createElement('header', null, 'Connect Agent title bar') }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: fixture.idToken }) }));
vi.mock('@/lib/analytics', () => ({ capture: vi.fn() }));
vi.mock('@/lib/desktop-host', () => ({ desktopHost: () => null }));
vi.mock('@/hooks/use-copy-to-clipboard', () => ({ useCopyToClipboard: () => ({}) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => fixture.mobile }));
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
vi.mock('./onboarding-connection-hero', () => ({ OnboardingConnectionHero: ({ onSetup }: { onSetup?: () => void }) => React.createElement('section', null, React.createElement('h1', null, 'Connect your agents to your workspace'), React.createElement('button', { onClick: onSetup }, 'Banner setup')) }));
vi.mock('./onboarding-pairing-panel', () => ({ OnboardingPairingPanel: ({ pairing, onRegenerate, regenerating, methodRequest }: { methodRequest?: { method: string }; pairing: { code: string }; onRegenerate?: () => void; regenerating?: boolean }) => React.createElement(React.Fragment, null, React.createElement('div', { 'data-testid': 'guided-pairing', 'data-method': methodRequest?.method }, pairing.code), onRegenerate && React.createElement('button', { onClick: onRegenerate, disabled: regenerating }, 'Renew pairing')) }));
let root: Root;
let container: HTMLDivElement;
function device(nodeId: string, status = 'online'): WorkspaceNode {
  return { nodeId, name: nodeId, status, hostname: nodeId, deviceType: 'server', os: 'linux',
    launcherVersion: '0.2.198', agents: [], runtimes: [], lastHeartbeatAt: null, createdAt: null };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fixture.needsFirstDevice = false;
  fixture.connectSetupRequest = null;
  fixture.mobile = false;
  fixture.idToken = null;
  api.sendSetupEmail.mockResolvedValue({ emailSent: true });
  api.createPairingCode.mockResolvedValue({ code: "TEST-CODE", expiresAt: "2099-01-01T00:00:00Z", expiresInSeconds: 1800 });
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


it('keeps both connection tabs and the same guided local setup on first run and reentry', async () => {
  fixture.needsFirstDevice = true;
  localStorage.setItem('oa:welcomeFilmSeen', '1');
  api.listNodes.mockResolvedValue([]);
  await act(async () => root.render(React.createElement(FirstRunOnboarding)));
  expect(container.querySelector('[data-testid="guided-pairing"]')?.textContent).toBe('TEST-CODE');
  expect(button('connect.tabNode')).toBeDefined();
  expect(button('connect.tabCloud')).toBeDefined();
  expect(container.textContent).not.toContain('connect.nodeEmptyTitle');
  await act(async () => button('connect.tabCloud').click());
  expect(container.querySelector('[data-testid="guided-pairing"]')).toBeNull();
  expect(button('connect.tabNode')).toBeDefined();
  await act(async () => button('connect.tabNode').click());
  expect(container.querySelector('[data-testid="guided-pairing"]')).not.toBeNull();
  expect(api.createPairingCode).toHaveBeenCalledTimes(1);
  // Reopening from Threads mounts the ordinary Connect Agent view, without autoPair.
  await act(async () => root.render(React.createElement(ConnectAgentView)));
  expect(container.querySelector('[data-testid="guided-pairing"]')?.textContent).toBe('TEST-CODE');
  expect(button('connect.tabNode')).toBeDefined();
  expect(button('connect.tabCloud')).toBeDefined();
  localStorage.removeItem('oa:welcomeFilmSeen');
});

it('waits for a successful device read before generating a first-device code', async () => {
  fixture.needsFirstDevice = true;
  let resolveNodes!: (nodes: WorkspaceNode[]) => void;
  api.listNodes.mockReturnValue(new Promise<WorkspaceNode[]>(resolve => { resolveNodes = resolve; }));
  await act(async () => root.render(React.createElement(ConnectAgentView)));
  expect(api.createPairingCode).not.toHaveBeenCalled();
  await act(async () => resolveNodes([]));
  expect(api.createPairingCode).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-testid="guided-pairing"]')).not.toBeNull();
});

it('offers a retry when first-device pairing fails without hiding the connection tabs', async () => {
  fixture.needsFirstDevice = true;
  api.createPairingCode.mockRejectedValueOnce(new Error('Unavailable'));
  await render([]);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('connect.nodePairingFailed');
  expect(button('connect.tabCloud')).toBeDefined();
  await act(async () => button('common.retry').click());
  expect(container.querySelector('[data-testid="guided-pairing"]')?.textContent).toBe('TEST-CODE');
});

it('does not mistake a failed device read for an empty workspace', async () => {
  fixture.needsFirstDevice = true;
  api.listNodes.mockRejectedValueOnce(new Error('Unavailable'));
  await act(async () => root.render(React.createElement(ConnectAgentView)));
  expect(api.createPairingCode).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid="nodes-load-failed"]')).not.toBeNull();
  expect(button('connect.tabCloud')).toBeDefined();
});


it('moves from first-device pairing into agent setup while keeping both tabs', async () => {
  fixture.needsFirstDevice = true;
  await render([]);
  api.listNodes.mockResolvedValue([device('new-device')]);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.querySelector('[data-testid="guided-pairing"]')).toBeNull();
  expect(container.querySelector('[aria-label="Agent gallery for new-device"]')).not.toBeNull();
  expect(button('connect.tabNode')).toBeDefined();
  expect(button('connect.tabCloud')).toBeDefined();
});


it('keeps the phone setup email action available in the shared tabbed setup', async () => {
  fixture.needsFirstDevice = true;
  fixture.mobile = true;
  fixture.idToken = 'test-id-token';
  await render([]);
  expect(button('connect.tabCloud')).toBeDefined();
  await act(async () => button('onboarding.setupEmailCta').click());
  expect(api.sendSetupEmail).toHaveBeenCalledWith('test-id-token', 'test-workspace');
  expect(container.querySelector('[role="status"]')?.textContent).toContain('onboarding.setupEmailSent');
});


it('places the banner above both connection tabs without the redundant title bar', async () => {
  fixture.needsFirstDevice = true;
  await render([]);
  const heading = container.querySelector('h1')!;
  const tabs = container.querySelector('[role="group"][aria-label="connect.title"]')!;
  expect(heading.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector('header')).toBeNull();
  await act(async () => button('connect.tabCloud').click());
  expect(container.querySelector('h1')).not.toBeNull();
  expect(button('connect.tabNode')).toBeDefined();
  await act(async () => button('Banner setup').click());
  expect(button('connect.tabNode').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('[data-testid="guided-pairing"]')).not.toBeNull();
});


it('keeps the pairing form on renewal failure and replaces the code after a successful retry', async () => {
  fixture.needsFirstDevice = true;
  api.createPairingCode
    .mockResolvedValueOnce({ code: 'EXPIRED-CODE', expiresAt: new Date(Date.now() - 1000).toISOString(), expiresInSeconds: 0 })
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ code: 'RENEWED-CODE', expiresAt: '2099-01-01T00:00:00Z', expiresInSeconds: 1800 });
  await render([]);
  await act(async () => button('Renew pairing').click());
  expect(container.querySelector('[data-testid="guided-pairing"]')?.textContent).toContain('EXPIRED-CODE');
  expect(button('Renew pairing').disabled).toBe(false);
  await act(async () => button('Renew pairing').click());
  expect(container.querySelector('[data-testid="guided-pairing"]')?.textContent).toContain('RENEWED-CODE');
  expect(button('connect.tabCloud')).toBeDefined();
  expect(api.createPairingCode).toHaveBeenCalledTimes(3);
});


it('applies a new Yumi location choice without replaying the old choice when a cached view returns', async () => {
  fixture.needsFirstDevice = true;
  fixture.connectSetupRequest = { method: 'desktop' };
  api.listNodes.mockResolvedValue([]);
  const renderCached = (visible: boolean) => root.render(React.createElement(React.Activity, { mode: visible ? 'visible' : 'hidden', children: React.createElement(ConnectAgentView) }));
  await act(async () => renderCached(true));
  expect(container.querySelector('[data-testid="guided-pairing"]')?.getAttribute('data-method')).toBe('desktop');
  await act(async () => button('connect.tabCloud').click());
  await act(async () => renderCached(false));
  await act(async () => renderCached(true));
  expect(button('connect.tabCloud').getAttribute('aria-pressed')).toBe('true');
  fixture.connectSetupRequest = { method: 'terminal' };
  await act(async () => renderCached(true));
  expect(button('connect.tabNode').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('[data-testid="guided-pairing"]')?.getAttribute('data-method')).toBe('terminal');
});

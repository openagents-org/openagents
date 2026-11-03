// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectAgentView } from './connect-agent-view';
import { toast } from 'sonner';
import type { WorkspaceNode } from '@/lib/types';

const api = vi.hoisted(() => ({
  getAgentCatalog: vi.fn(), getCloudProviders: vi.fn(), listCloudAgents: vi.fn(),
  listNodes: vi.fn(), createPairingCode: vi.fn(), sendSetupEmail: vi.fn(),
}));
const fixture = vi.hoisted(() => ({ needsFirstDevice: false, mobile: false, idToken: null as string | null, openView: vi.fn() }));
vi.mock('@/lib/account-api', () => ({ sendSetupEmail: api.sendSetupEmail }));
vi.mock('@/lib/api', () => ({ workspaceApi: api }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  workspace: { workspaceId: 'test-workspace', slug: 'test-workspace', needsFirstDevice: fixture.needsFirstDevice }, token: 'test-token', agents: [], refreshWorkspace: vi.fn(),
}) }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ openView: fixture.openView, isMobile: false }) }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: () => null }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: fixture.idToken }) }));
vi.mock('@/lib/analytics', () => ({ capture: vi.fn() }));
vi.mock('@/lib/desktop-host', () => ({ desktopHost: () => null }));

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
vi.mock('./onboarding-connection-hero', () => ({ OnboardingConnectionHero: () => React.createElement('h1', null, 'Connect your agents to your workspace') }));
vi.mock('./onboarding-pairing-panel', () => ({ OnboardingPairingPanel: ({ pairing }: { pairing: { code: string } }) => React.createElement('div', { 'data-testid': 'guided-pairing' }, pairing.code) }));
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
async function pairingButtons() {
  await render([device('existing')]);
  const generate = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('connect.nodeConnect'));
  expect(generate).toBeDefined();
  await act(async () => generate!.click());
  return {
    command: container.querySelector<HTMLButtonElement>('button[title="connect.nodeCopyCommand"]')!,
    code: [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('TEST-CODE'))!,
  };
}
it.each(['command', 'code'] as const)('%s ignores a stale success after a newer failed copy', async kind => {
  const buttons = await pairingButtons();
  const target = buttons[kind]; expect(target).toBeDefined();
  let finish!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
  await act(async () => target.click());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  await act(async () => target.click());
  expect(toast.error).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(target.querySelector('.lucide-check')).toBeNull();
});
it.each(['command', 'code'] as const)('%s keeps the latest successful indicator for its full timeout', async kind => {
  const target = (await pairingButtons())[kind]; expect(target).toBeDefined();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  await act(async () => target.click());
  await act(async () => vi.advanceTimersByTime(1000));
  await act(async () => target.click());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(target.querySelector('.lucide-check')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(target.querySelector('.lucide-check')).toBeNull();
});

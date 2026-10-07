// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectAgentView } from './connect-agent-view';

const api = vi.hoisted(() => ({
  getAgentCatalog: vi.fn(), getCloudProviders: vi.fn(), listCloudAgents: vi.fn(),
  modelProbe: vi.fn(), addCloudAgent: vi.fn(),
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
  api.getCloudProviders.mockResolvedValue([{ name: 'tokenpay', label: 'TokenPay', base_url: 'https://tokendance.space/gateway/v1', models: [] }]);
  api.listCloudAgents.mockResolvedValue([]);
  api.modelProbe.mockReset();
  api.addCloudAgent.mockReset().mockResolvedValue({});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement<{ initialTab: 'cloud' }>(ConnectAgentView, { initialTab: 'cloud' })); });
  const provider = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('TokenPay'))!;
  expect(provider).toBeDefined();
  await act(async () => provider.click());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function enterKey(value: string) {
  const input = container.querySelector<HTMLInputElement>('#tokenpay-key')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}
function addButton() {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'connect.cloudAgentAddButton')!;
}

it('selects TokenPay, enters a key, chooses a live model, and adds the agent without an endpoint field', async () => {
  expect(container.querySelector('#cloud-base-url')).toBeNull();
  expect(addButton().disabled).toBe(true);
  api.modelProbe.mockResolvedValue({ keyOk: true, models: [{ id: 'glm-5', label: 'Z.ai: GLM 5', category: 'chat' }] });
  await enterKey('test-key');
  expect(container.textContent).toContain('Z.ai: GLM 5');
  expect(addButton().disabled).toBe(false);
  await act(async () => addButton().click());
  expect(api.addCloudAgent).toHaveBeenCalledWith({
    agentName: 'glm-5', provider: 'tokenpay', model: 'glm-5', apiKey: 'test-key', baseUrl: undefined, systemPrompt: undefined,
  });
});

it('keeps adding disabled and displays a rejected-key error', async () => {
  api.modelProbe.mockResolvedValue({ keyOk: false, error: 'The provider rejected this API key' });
  await enterKey('invalid-key');
  expect(container.textContent).toContain('The provider rejected this API key');
  expect(addButton().disabled).toBe(true);
  expect(api.addCloudAgent).not.toHaveBeenCalled();
});

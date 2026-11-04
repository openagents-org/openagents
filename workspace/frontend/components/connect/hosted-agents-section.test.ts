// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HostedAgentsSection } from './hosted-agents-section';

const api = vi.hoisted(() => ({
  getHostedProviders: vi.fn(), listHostedAgents: vi.fn(), launchHostedAgent: vi.fn(), removeHostedAgent: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ workspaceApi: api }));
vi.mock('@/lib/analytics', () => ({ capture: vi.fn() }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => confirm }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const onChanged = vi.fn();
let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () => { root.render(React.createElement(HostedAgentsSection, { onChanged })); });
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label || b.title === label)!;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.getHostedProviders.mockResolvedValue([{ name: 'acenta', label: 'Acenta', available: true, harness: 'opencode', url: 'https://acenta.ai' }]);
  api.listHostedAgents.mockResolvedValue([]);
  api.launchHostedAgent.mockReset().mockResolvedValue({ setupUrl: null });
  api.removeHostedAgent.mockReset().mockResolvedValue(undefined);
  confirm.mockReset();
  onChanged.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('launches a named agent and refreshes the workspace roster', async () => {
  await render();
  expect(container.querySelector('input')).toBeNull();
  await act(async () => button('connect.acentaGetStarted').click());
  const input = document.querySelector<HTMLInputElement>('input')!;
  expect(button('connect.acentaContinue').disabled).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, ' Research helper ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('connect.acentaContinue').click());
  expect(api.launchHostedAgent).toHaveBeenCalledWith('Research helper');
  expect(onChanged).toHaveBeenCalled();
});

it('explains when the provider is not configured', async () => {
  api.getHostedProviders.mockResolvedValue([{ name: 'acenta', label: 'Acenta', available: false, harness: 'opencode', url: '' }]);
  await render();
  expect(container.textContent).toContain('connect.acentaUnavailable');
  expect(container.querySelector('input')).toBeNull();
});

it('shows presence and removes only after confirmation', async () => {
  api.listHostedAgents.mockResolvedValue([
    { agentName: 'acenta-1a2b3c4d', displayName: 'Research helper', provider: 'acenta', status: 'active', presence: 'online', ownerEmail: 'a@b.c', createdAt: null },
  ]);
  await render();
  expect(container.textContent).toContain('connect.acentaOnline');
  confirm.mockResolvedValueOnce(false);
  await act(async () => button('connect.remove').click());
  expect(api.removeHostedAgent).not.toHaveBeenCalled();
  confirm.mockResolvedValueOnce(true);
  await act(async () => button('connect.remove').click());
  expect(api.removeHostedAgent).toHaveBeenCalledWith('acenta-1a2b3c4d');
});

it('sends the user to Acenta when setup (sign-in and payment) is needed', async () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  api.launchHostedAgent.mockResolvedValue({ setupUrl: 'https://acenta.ai/launch/box-1' });
  await render();
  expect(container.querySelector('input')).toBeNull();
  await act(async () => button('connect.acentaGetStarted').click());
  const input = document.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Helper');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('connect.acentaContinue').click());
  expect(assign).toHaveBeenCalledWith('https://acenta.ai/launch/box-1');
  expect(onChanged).not.toHaveBeenCalled();
});

it('offers to finish setup for a launch waiting on Acenta', async () => {
  api.listHostedAgents.mockResolvedValue([
    { agentName: 'acenta-1a2b3c4d', displayName: 'Helper', provider: 'acenta', status: 'setup', setupUrl: 'https://acenta.ai/launch/box-1', presence: 'offline', ownerEmail: 'a@b.c', createdAt: null },
  ]);
  await render();
  const link = container.querySelector<HTMLAnchorElement>('a')!;
  expect(link.href).toBe('https://acenta.ai/launch/box-1');
  expect(link.textContent).toContain('connect.acentaFinishSetup');
});

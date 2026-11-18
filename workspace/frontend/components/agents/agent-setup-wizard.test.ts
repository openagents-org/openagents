// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentSetup, type AgentSetupApi } from './agent-setup';
import type { AgentCatalogDetail, AgentCatalogEntry, WorkspaceNode } from '@/lib/types';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';

const seal = vi.hoisted(() => vi.fn());
vi.mock('./encrypt-agent-credentials', () => ({ encryptAgentCredentials: seal }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, params?: Record<string, string | number>) => translate(messages, messages, 'en-US', key, params) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => React.createElement('select', { value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange(event.target.value) }, children),
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectGroup: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => React.createElement('option', { value }, children),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { seal.mockReset(); seal.mockImplementation(async (_api, _node, _action, args) => { const { apiKey, config, ...rest } = args; return { ...rest, encryptedCredentials: { ciphertext: 'sealed' } }; }); });
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });

async function open({ signedIn = false, type = 'codex', detailFails = false, detailPending = false, deviceModels = [], browserLogin = false, installed = true, existingNames = [] }: { signedIn?: boolean; type?: string; detailFails?: boolean; detailPending?: boolean; deviceModels?: { id: string; label: string }[]; browserLogin?: boolean; installed?: boolean; existingNames?: string[] } = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const detail = {
    name: type, label: type, models: [{ id: 'gpt-6', label: 'GPT-6' }],
    check_ready: type === 'codex' ? { login_command: 'codex login' } : {},
    resolve_env: { rules: [{ from: 'LLM_API_KEY', to: 'OPENAI_API_KEY' }] },
  } as unknown as AgentCatalogDetail;
  const api = {
    getAgentCatalogDetail: detailPending ? vi.fn(() => new Promise<AgentCatalogDetail>(() => {})) : detailFails ? vi.fn().mockRejectedValue(new Error('Unavailable')) : vi.fn().mockResolvedValue(detail),
    listModelAccess: vi.fn().mockResolvedValue([]), listNodeCommands: vi.fn(),
    enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'c1' }),
  } as unknown as AgentSetupApi;
  const node = { nodeId: 'n1', name: 'My server', launcherVersion: '0.2.230', agents: existingNames.map(name => ({ name, type })), runtimes: [{ type, installed, ready: signedIn, signedIn, browserLogin, loginCommand: type === 'codex' ? 'codex login' : type === 'claude' ? 'claude auth login' : undefined, cliModels: deviceModels }] } as unknown as WorkspaceNode;
  const onQueued = vi.fn();
  await act(async () => root.render(React.createElement(AgentSetup, { node, catalog: [{ name: type, label: type } as AgentCatalogEntry], initialType: type, api, extensions: { guided: true }, onBack: () => {}, onChanged: () => {}, onQueued })));
  return { api, onQueued };
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function next() {
  const button = host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-continue"]');
  if (button) await act(async () => button.click());
}
async function choose(method: string) { await next(); await act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="agent-setup-auth-${method}"]`)!.click()); }
async function typeKey(value: string) {
  const input = host.querySelector<HTMLInputElement>('#setup-api-key')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const submit = async () => { await next(); await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!.click()); };
const creates = (api: AgentSetupApi) => vi.mocked(api.enqueueNodeCommand).mock.calls.filter((c) => c[1] === 'create_agent');

it('starts with naming and keeps account options for the next step', async () => {
  const { api } = await open({ detailPending: true });
  expect(api.listModelAccess).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="agent-setup-details-step"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="agent-setup-auth-step"]')?.closest('[hidden]')).toBeTruthy();
  expect(host.querySelector('details')?.open).toBe(false);
  const name = host.querySelector<HTMLInputElement>('[data-testid="agent-setup-name"]')!;
  expect(name.required).toBe(true);
  expect(name.closest('details')).toBeNull();
  expect(host.querySelector('[data-testid="agent-setup-submit"]')).toBeNull();
  expect(host.querySelector('[aria-current="step"]')?.textContent).toContain(messages.agentSetup.nameStep);
  await next();
  expect(host.querySelector('[data-testid="agent-setup-auth-step"]')?.closest('[hidden]')).toBeNull();
  expect(host.querySelector('[data-testid="agent-setup-details-step"]')).toBeNull();
  expect(host.querySelector('[aria-current="step"]')?.textContent).toContain(messages.agentSetup.accountStep);
  expect(creates(api)).toHaveLength(0);
});

it.each(['claude', 'codex'])('uses a detected %s subscription without sending a key or requiring another login', async (type) => {
  const { api } = await open({ signedIn: true, type });
  await next();
  expect(host.textContent).toContain('Already signed in on My server');
  expect(host.querySelector('[data-testid="agent-setup-auth-subscription"]')?.getAttribute('aria-checked')).toBe('true');
  await submit();
  expect(creates(api)[0][2]).toMatchObject({ name: type, type, authMode: 'cli_login' });
  expect(creates(api)[0][2]).not.toHaveProperty('apiKey');
  expect(seal).not.toHaveBeenCalled();
});

it('offers the device login command and recheck without pretending sign-in succeeded', async () => {
  const { api } = await open();
  await choose('subscription');
  expect(host.querySelector('code')?.textContent).toBe('codex login');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!.disabled).toBe(true);
  await click(messages.agentSetup.checkAgain);
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'detect_runtimes', {});
  expect(creates(api)).toEqual([]);
});

it('lets key-only agents be added explicitly for setup later', async () => {
  const { api } = await open({ type: 'deepseek' });
  expect(host.querySelector('[data-testid="agent-setup-auth-subscription"]')).toBeNull();
  await choose('later'); await submit();
  expect(creates(api)).toHaveLength(1);
  expect(creates(api)[0][2]).not.toHaveProperty('apiKey');
  expect(seal).not.toHaveBeenCalled();
});

it('encrypts a newly supplied key and does not retain it in queued retry data', async () => {
  const { api, onQueued } = await open();
  await choose('key'); await typeKey('sk-secret'); await submit();
  expect(seal).toHaveBeenCalledWith(api, 'n1', 'create_agent', expect.objectContaining({ apiKey: 'sk-secret' }), messages.agentSetup.secureUnavailable);
  expect(creates(api)[0][2]).toHaveProperty('encryptedCredentials');
  expect(creates(api)[0][2]).not.toHaveProperty('apiKey');
  expect(JSON.stringify(onQueued.mock.calls)).not.toContain('sk-secret');
});

it('does not send any create command when secure key delivery fails', async () => {
  seal.mockRejectedValueOnce(new Error('Old connector'));
  const { api } = await open();
  await choose('key'); await typeKey('sk-secret'); await submit();
  expect(creates(api)).toEqual([]);
  expect(host.textContent).toContain(messages.agentSetup.secureUnavailable);
});

it('clears a pasted key when switching to setup later', async () => {
  const { api } = await open();
  await choose('key'); await typeKey('sk-secret'); await choose('later'); await submit();
  expect(seal).not.toHaveBeenCalled();
  expect(creates(api)[0][2]).not.toHaveProperty('apiKey');
});

it('requires metadata only for key setup and offers a retry if that fails', async () => {
  await open({ detailFails: true });
  await choose('key');
  expect(host.textContent).toContain(messages.agentSetup.loadError);
  expect(host.querySelector('[role="radiogroup"]')).toBeTruthy();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!.disabled).toBe(true);
});

it('can add for setup later without waiting for registry options', async () => {
  const { api } = await open({ detailPending: true });
  expect(host.textContent).not.toContain(messages.agentSetup.loading);
  await choose('later'); await submit();
  expect(creates(api)).toHaveLength(1);
  expect(creates(api)[0][2]).not.toHaveProperty('model');
});

it('can use an already detected subscription without waiting for registry options', async () => {
  const { api } = await open({ signedIn: true, detailPending: true });
  expect(host.textContent).not.toContain(messages.agentSetup.loading);
  await submit();
  expect(creates(api)[0][2]).toMatchObject({ authMode: 'cli_login' });
  expect(creates(api)[0][2]).not.toHaveProperty('model');
});

it('keeps model selection open-ended and does not present the registry list as current', async () => {
  const { api } = await open();
  const input = host.querySelector<HTMLInputElement>('#setup-model')!;
  expect(input.value).toBe('');
  expect(host.querySelector('select')).toBeNull();
  expect(host.querySelector('datalist')).toBeNull();
  expect(host.textContent).not.toContain('GPT-6');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'future-account-model');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await choose('later'); await submit();
  expect(creates(api)[0][2]).toMatchObject({ model: 'future-account-model' });
});

it('offers only device-reported models as optional suggestions', async () => {
  await open({ deviceModels: [{ id: 'live-model', label: 'Device model' }] });
  expect(host.querySelector<HTMLInputElement>('#setup-model')!.value).toBe('');
  expect([...host.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual(['live-model']);
  expect(host.querySelector('datalist')?.textContent).not.toContain('GPT-6');
});


it('offers browser sign-in only when the connector advertises support', async () => {
  await open({ browserLogin: true });
  await choose('subscription');
  expect(host.querySelector('[data-testid="browser-agent-login"]')).toBeTruthy();
  expect(host.querySelector('code')).toBeNull();
  expect(host.textContent).toContain('Sign in to Codex');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!.disabled).toBe(true);
});

 it('blocks an empty or whitespace-only name before creating an agent', async () => {
  const { api } = await open({ signedIn: true });
  const input = host.querySelector<HTMLInputElement>('[data-testid="agent-setup-name"]')!;
  for (const value of ['', '   ']) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-continue"]')!.disabled).toBe(true);
    await next();
  }
  expect(creates(api)).toEqual([]);
});

it('preserves name, model, key and chosen authentication when going back', async () => {
  await open();
  const name = host.querySelector<HTMLInputElement>('[data-testid="agent-setup-name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'my-codex');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const model = host.querySelector<HTMLInputElement>('#setup-model')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(model, 'my-model');
    model.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await choose('key'); await typeKey('sk-stays-in-memory');
  await click(messages.agentSetup.back);
  expect(host.querySelector<HTMLInputElement>('[data-testid="agent-setup-name"]')!.value).toBe('my-codex');
  expect(host.querySelector<HTMLInputElement>('#setup-model')!.value).toBe('my-model');
  await next();
  expect(host.querySelector('[data-testid="agent-setup-auth-key"]')?.getAttribute('aria-checked')).toBe('true');
  expect(host.querySelector<HTMLInputElement>('#setup-api-key')!.value).toBe('sk-stays-in-memory');
});

it('rejects an invalid name before authentication', async () => {
  const { api } = await open();
  const name = host.querySelector<HTMLInputElement>('[data-testid="agent-setup-name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'bad name!');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await next();
  expect(host.querySelector('[data-testid="agent-setup-name-error"]')?.textContent).toBe(messages.connect.agentNameInvalid);
  expect(host.querySelector('[data-testid="agent-setup-submit"]')).toBeNull();
  expect(creates(api)).toHaveLength(0);
});

it('blocks a duplicate name on the naming step', async () => {
  const { api } = await open({ existingNames: ['already-used'] });
  const name = host.querySelector<HTMLInputElement>('[data-testid="agent-setup-name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'already-used');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-continue"]')!.disabled).toBe(true);
  expect(host.querySelector('[data-testid="agent-setup-name-error"]')?.textContent).toBe(messages.connect.agentNameExists);
  await next();
  expect(host.querySelector('[data-testid="agent-setup-submit"]')).toBeNull();
  expect(creates(api)).toHaveLength(0);
});

it('offers browser sign-in before Codex is installed and waits for authentication', async () => {
  await open({ browserLogin: true, installed: false });
  await choose('subscription');
  expect(host.textContent).toContain('Install and sign in to Codex');
  expect(host.querySelector('code')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!.disabled).toBe(true);
});

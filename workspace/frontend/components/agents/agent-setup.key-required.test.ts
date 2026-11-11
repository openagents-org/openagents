// @vitest-environment jsdom
/**
 * A type with no sign-in of its own (DeepSeek) cannot answer without a key,
 * and "no key" is reliable for it: the form does not add one until it has a
 * key, a saved one or the key its type has on the device. A type with a
 * sign-in keeps the warning and "Add anyway" (agent-setup.needs-credentials
 * .test.ts): its sign-in detection is a best guess for some (CodeBuddy,
 * Codex), so it picks the default and the message, never a block. An edit
 * that leaves the credentials as they were is never refused.
 */
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { AgentCatalogDetail, AgentCatalogEntry, NodeAgent, NodeRuntime, WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentSetupApi } from './agent-setup';
import deepseekEntry from '../../../backend/registry/deepseek.json';
import opencodeEntry from '../../../backend/registry/opencode.json';
import codebuddyEntry from '../../../backend/registry/codebuddy.json';

const t = (key: string, params?: Record<string, string | number>) => translate(messages, messages, 'en-US', key, params);
vi.mock('@/lib/i18n', () => ({ useT: () => t }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Keep the form's state and submission real; use native selects for DOM events.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => createElement('select', { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValueChange(e.target.value) }, children),
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => createElement('option', { value }, children),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });

const ENTRIES: Record<string, { label: string }> = { deepseek: deepseekEntry, opencode: opencodeEntry, codebuddy: codebuddyEntry };
const SAVED_KEY = {
  id: 'acc-deepseek', label: 'DeepSeek', provider: 'deepseek', baseUrl: null,
  apiKeyMasked: 'sk-2...98d7', createdBy: null, status: 'active', createdAt: null,
};

async function open({ type = 'deepseek', runtime = {}, editAgent, models = [] }: { type?: string; runtime?: Partial<NodeRuntime>; editAgent?: NodeAgent; models?: { id: string; label: string }[] } = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const api = {
    getAgentCatalogDetail: vi.fn().mockResolvedValue({ ...ENTRIES[type], models } as unknown as AgentCatalogDetail),
    listModelAccess: vi.fn().mockResolvedValue([SAVED_KEY]),
    probeModelAccess: vi.fn().mockResolvedValue({ keyOk: true, models: [{ id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' }] }),
    enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'cmd1' }),
  } as unknown as AgentSetupApi;
  const node = {
    nodeId: 'n1', name: 'LAPTOP-VON9RSJS', launcherVersion: '0.2.213',
    agents: editAgent ? [editAgent] : [],
    runtimes: [{ type, installed: true, ready: false, ...runtime }],
  } as unknown as WorkspaceNode;
  await act(async () => root.render(createElement(AgentSetup, {
    node, catalog: [{ name: type, label: ENTRIES[type].label } as AgentCatalogEntry], api,
    ...(editAgent ? { editAgent } : { initialType: type }),
    onBack: () => {}, onChanged: () => {}, onQueued: () => {},
  })));
  for (let i = 0; i < 3; i++) await act(async () => {});
  return api;
}

const credentialSelect = () => [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === '__none__'))!;
const optionValues = () => [...credentialSelect().options].map((o) => o.value);
const choose = async (select: HTMLSelectElement, value: string) => {
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  for (let i = 0; i < 3; i++) await act(async () => {});
};
const submit = async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!.click());
  for (let i = 0; i < 3; i++) await act(async () => {});
};
const sent = (api: AgentSetupApi) => (api.enqueueNodeCommand as ReturnType<typeof vi.fn>).mock.calls;
const keyRequired = () => host.querySelector('[data-testid="agent-setup-creds-required"]');
const notSignedIn = () => host.querySelector('[data-testid="agent-setup-not-signed-in"]');
const submitText = () => host.querySelector('[data-testid="agent-setup-submit"]')!.textContent;

it('does not add a key-only agent until a key is picked', async () => {
  const api = await open();
  expect(credentialSelect().selectedOptions[0].textContent).toBe(t('connect.byokPickKey'));
  expect(keyRequired()!.textContent).toContain(t('connect.byokKeyRequired', { label: deepseekEntry.label }));
  expect(keyRequired()!.getAttribute('role')).toBeNull();

  // No "Add anyway": every click is stopped and points at the key.
  await submit();
  await submit();
  expect(sent(api)).toEqual([]);
  expect(keyRequired()!.getAttribute('role')).toBe('alert');
  expect(host.querySelector('[data-testid="agent-setup-submit"]')!.textContent).toBe(t('connect.agentAddTitle'));
});

it('adds it on a saved key', async () => {
  const api = await open();
  await choose(credentialSelect(), SAVED_KEY.id);
  expect(keyRequired()).toBeNull();
  const modelSelect = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'deepseek-v4-flash'))!;
  await choose(modelSelect, 'deepseek-v4-flash');
  await submit();
  expect(sent(api)).toHaveLength(1);
  expect(sent(api)[0][1]).toBe('create_agent');
  expect(sent(api)[0][2]).toMatchObject({ type: 'deepseek', modelAccessId: SAVED_KEY.id, model: 'deepseek-v4-flash' });
});

it('offers the key the device has for the type, and adds the agent on it', async () => {
  const api = await open({ runtime: { ready: true, typeReady: true } });
  expect(optionValues()).toContain('__device_key__');
  // Known to be set up, so picked for the user: no key is required.
  expect(credentialSelect().value).toBe('__device_key__');
  expect(keyRequired()).toBeNull();
  expect(host.querySelector('[data-testid="agent-setup-device-key-hint"]')!.textContent)
    .toBe(t('connect.byokDeviceKeyHint', { label: deepseekEntry.label, device: 'LAPTOP-VON9RSJS' }));
  await submit();
  expect(sent(api)).toHaveLength(1);
  const args = sent(api)[0][2];
  expect(args).not.toHaveProperty('apiKey');
  expect(args).not.toHaveProperty('modelAccessId');
  expect(args).not.toHaveProperty('authMode');
});

it("does not offer a key another agent holds, or one a device too old to say may hold", async () => {
  await open({ runtime: { ready: true, typeReady: false } });
  expect(optionValues()).not.toContain('__device_key__');
  await act(async () => root.unmount());
  host.remove();
  await open({ runtime: { ready: true } });
  expect(optionValues()).not.toContain('__device_key__');
});

it('saves a rename of a key-only agent with no key anywhere, its credentials untouched', async () => {
  const api = await open({ editAgent: { name: 'deepseek', type: 'deepseek', status: 'stopped', authMode: null, apiKeyMasked: null } as NodeAgent });
  // Said, not enforced: nothing about its credentials changes.
  expect(keyRequired()!.getAttribute('role')).toBeNull();
  await submit();
  expect(sent(api)).toHaveLength(1);
  expect(sent(api)[0][1]).toBe('configure_agent');
  const args = sent(api)[0][2];
  expect(args).not.toHaveProperty('apiKey');
  expect(args).not.toHaveProperty('modelAccessId');
  expect(args).not.toHaveProperty('authMode');
});

it('opens a key-only agent with no key of its own on the key its device has', async () => {
  const api = await open({
    runtime: { ready: true, typeReady: true },
    editAgent: { name: 'deepseek', type: 'deepseek', status: 'running', authMode: null, apiKeyMasked: null } as NodeAgent,
  });
  expect(credentialSelect().value).toBe('__device_key__');
  expect(keyRequired()).toBeNull();
  await submit();
  expect(sent(api)).toHaveLength(1);
});

it('refuses an edit that takes a key-only agent off its key onto nothing', async () => {
  const api = await open({ editAgent: { name: 'deepseek-keyed', type: 'deepseek', status: 'running', authMode: 'api_key', apiKeyMasked: 'sk-t...1234' } as NodeAgent });
  await choose(credentialSelect(), '__none__');
  await submit();
  await submit();
  expect(sent(api)).toEqual([]);
  expect(keyRequired()!.getAttribute('role')).toBe('alert');
});

it('saves an agent on its own key as it is', async () => {
  const api = await open({ editAgent: { name: 'deepseek-keyed', type: 'deepseek', status: 'running', authMode: 'api_key', apiKeyMasked: 'sk-t...1234' } as NodeAgent });
  expect(credentialSelect().value).toBe('__keep_current__');
  expect(keyRequired()).toBeNull();
  await submit();
  expect(sent(api)).toHaveLength(1);
  expect(sent(api)[0][1]).toBe('configure_agent');
});

it('offers OpenCode its sign-in, picked once the device has one, and never blocks on it', async () => {
  // OpenCode signs in with `opencode auth login` (no login_command, so no
  // sign-in marker).
  await open({ type: 'opencode', runtime: { ready: true, signedIn: true, loginCommand: 'agn login opencode' } });
  expect(credentialSelect().value).toBe('__sign_in__');
  expect(host.querySelector('[data-testid="agent-setup-title-required"]')).toBeNull();
  await act(async () => root.unmount());
  host.remove();

  const api = await open({ type: 'opencode' });
  expect(optionValues()).toContain('__sign_in__');
  expect(credentialSelect().value).toBe('__none__');
  await submit();
  expect(sent(api)).toEqual([]);
  expect(submitText()).toBe(t('connect.agentAddAnyway'));
  await submit();
  expect(sent(api)).toHaveLength(1);
  expect(sent(api)[0][2]).not.toHaveProperty('authMode');
});

it('lets OpenCode run a free opencode/ model with neither', async () => {
  const api = await open({ type: 'opencode', models: [{ id: 'opencode/big-pickle', label: 'Big Pickle' }] });
  const modelSelect = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'opencode/big-pickle'))!;
  await choose(modelSelect, 'opencode/big-pickle');
  expect(keyRequired()).toBeNull();
  await submit();
  expect(sent(api)).toHaveLength(1);
});

// CodeBuddy's sign-in cannot be confirmed without a run (`unverifiable`):
// the device may say "not signed in" for an account that is.
const CODEBUDDY_NOT_DETECTED = { type: 'codebuddy', runtime: { ready: false, signedIn: false, loginCommand: 'codebuddy' } };

it('lets a CodeBuddy user the device does not see as signed in pick the sign-in and add anyway', async () => {
  const api = await open(CODEBUDDY_NOT_DETECTED);
  expect(optionValues()).toContain('__sign_in__');
  // The message follows the detection; nothing is picked on it.
  expect(credentialSelect().value).toBe('__none__');
  expect(notSignedIn()!.textContent).toContain(t('connect.byokNotSignedInRequired'));

  await choose(credentialSelect(), '__sign_in__');
  // The first click points at the warning, the second adds on the sign-in.
  await submit();
  expect(sent(api)).toEqual([]);
  expect(notSignedIn()!.getAttribute('role')).toBe('alert');
  expect(submitText()).toBe(t('connect.agentAddAnyway'));
  await submit();
  expect(sent(api)).toHaveLength(1);
  expect(sent(api)[0][1]).toBe('create_agent');
  expect(sent(api)[0][2]).toMatchObject({ type: 'codebuddy', authMode: 'cli_login' });
  expect(sent(api)[0][2]).not.toHaveProperty('apiKey');
});

it('picks the sign-in for a device signed in, and adds at once', async () => {
  const api = await open({ type: 'codebuddy', runtime: { ready: true, signedIn: true, loginCommand: 'codebuddy' } });
  expect(credentialSelect().value).toBe('__sign_in__');
  expect(notSignedIn()).toBeNull();
  await submit();
  expect(sent(api)).toHaveLength(1);
  expect(sent(api)[0][2]).toMatchObject({ authMode: 'cli_login' });
});

it('saves a rename of a signed-in agent the device does not see as signed in', async () => {
  const api = await open({
    ...CODEBUDDY_NOT_DETECTED,
    editAgent: { name: 'codebuddy', type: 'codebuddy', status: 'running', authMode: 'cli_login', apiKeyMasked: null } as NodeAgent,
  });
  // It opens on the sign-in it runs on, and the edit only warns.
  expect(credentialSelect().value).toBe('__sign_in__');
  expect(notSignedIn()!.textContent).toContain(t('connect.byokNotSignedInHint'));
  await submit();
  expect(sent(api)).toHaveLength(1);
  expect(sent(api)[0][1]).toBe('configure_agent');
});

it('marks only key-only types as needing a credential', async () => {
  await open();
  expect(host.querySelector('[data-testid="agent-setup-title-required"]')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
  await open(CODEBUDDY_NOT_DETECTED);
  expect(host.querySelector('[data-testid="agent-setup-title-required"]')).toBeNull();
});

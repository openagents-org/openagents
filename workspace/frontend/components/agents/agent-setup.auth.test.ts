// @vitest-environment jsdom
/**
 * Which credential a Codex agent runs on. A device can hold Codex's own
 * sign-in (`codex login`) and any number of keys, and the form has to say, and
 * send, which one an agent is on.
 */
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { AgentCatalogDetail, AgentCatalogEntry, NodeAgent, WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentSetupApi } from './agent-setup';

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

const codexDetail = {
  name: 'codex', label: 'OpenAI Codex CLI', models: [],
  check_ready: { login_command: 'codex login' },
  resolve_env: { rules: [{ from: 'LLM_API_KEY', to: 'OPENAI_API_KEY' }, { from: 'LLM_MODEL', to: 'CODEX_MODEL' }] },
};

async function open({ editAgent, agents = [] }: { editAgent?: NodeAgent; agents?: NodeAgent[] } = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const api = {
    getAgentCatalogDetail: vi.fn().mockResolvedValue(codexDetail as unknown as AgentCatalogDetail),
    listModelAccess: vi.fn().mockResolvedValue([]),
    enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'cmd1' }),
  } as unknown as AgentSetupApi;
  const node = {
    nodeId: 'n1', name: 'LAPTOP', launcherVersion: '0.2.198',
    agents: editAgent ? [editAgent, ...agents] : agents,
    runtimes: [{ type: 'codex', installed: true, ready: true }],
  } as unknown as WorkspaceNode;
  await act(async () => root.render(createElement(AgentSetup, {
    node, catalog: [{ name: 'codex', label: 'OpenAI Codex CLI' } as AgentCatalogEntry], api,
    ...(editAgent ? { editAgent } : { initialType: 'codex' }),
    onBack: () => {}, onChanged: () => {}, onQueued: () => {},
  })));
  for (let i = 0; i < 3; i++) await act(async () => {});
  return api;
}

const credentialSelect = () => [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === '__none__'))!;
const choose = async (select: HTMLSelectElement, value: string) => {
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
};
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

it('adds a codex agent on the device sign-in and tells the device so', async () => {
  const api = await open();
  const select = credentialSelect();
  expect(select.selectedOptions[0].textContent).toBe(t('connect.byokDeviceSignIn', { command: 'codex login' }));
  expect(host.querySelector('[data-testid="agent-setup-signin-hint"]')?.textContent)
    .toContain(t('connect.byokDeviceSignInHint', { label: 'OpenAI Codex CLI', command: 'codex login' }));

  await act(async () => button(messages.connect.agentAddTitle).click());
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'create_agent', expect.objectContaining({ type: 'codex', authMode: 'cli_login' }));
});

it('opens an agent on a device-saved key on that key, and a save leaves its model alone', async () => {
  const agent = {
    name: 'codex-Pro-1021', type: 'codex', status: 'running', model: 'openai-gpt-oss-20b',
    authMode: 'api_key', apiKeyMasked: 'sk-a...cdef', baseUrlHost: 'api-gateway.openagents.org', codexWireApi: 'responses',
  } as NodeAgent;
  const api = await open({ editAgent: agent });

  const select = credentialSelect();
  expect(select.selectedOptions[0].textContent).toBe(t('connect.byokKeepCurrent', { detail: 'sk-a...cdef · api-gateway.openagents.org' }));
  expect(host.querySelector('[data-testid="agent-setup-signin-hint"]')).toBeNull();
  // The model it runs on is shown, so it is no longer saved blind.
  expect(host.querySelector<HTMLInputElement>(`input[aria-label="${messages.connect.nodeModel}"]`)!.value).toBe('openai-gpt-oss-20b');

  await act(async () => button(messages.connect.nodeSaveChanges).click());
  const args = vi.mocked(api.enqueueNodeCommand).mock.calls[0][2] as Record<string, unknown>;
  expect(args).not.toHaveProperty('model');
  expect(args).not.toHaveProperty('authMode');
});

it('switches an agent from its key to the device sign-in only when asked', async () => {
  const agent = {
    name: 'codex-2', type: 'codex', status: 'running', model: 'openai-gpt-oss-20b',
    authMode: 'api_key', apiKeyMasked: 'sk-a...cdef', baseUrlHost: 'api-gateway.openagents.org',
  } as NodeAgent;
  const api = await open({ editAgent: agent });

  await choose(credentialSelect(), '__none__');
  expect(host.textContent).toContain(messages.connect.byokSwitchToSignInHint);
  await act(async () => button(messages.connect.nodeSaveChanges).click());
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'configure_agent', expect.objectContaining({ name: 'codex-2', authMode: 'cli_login' }));
});

it('leaves the model of an agent from an older device alone when it was not changed', async () => {
  // No authMode and no key reported: the old roster read LLM_MODEL only.
  const agent = { name: 'codex-old', type: 'codex', status: 'running', model: 'gpt-5.5' } as NodeAgent;
  const api = await open({ editAgent: agent });
  await act(async () => button(messages.connect.nodeSaveChanges).click());
  const args = vi.mocked(api.enqueueNodeCommand).mock.calls[0][2] as Record<string, unknown>;
  expect(args).not.toHaveProperty('model');
});

// @vitest-environment jsdom
/**
 * The model picker for an agent on the device's own sign-in ("sign in on the
 * device": `codex login`, `claude auth login`): it offers what the device's CLI
 * says that account can run, not the vendor line-up from the catalog, which
 * the account may not be served. Read off the real registry entries, so the
 * form is tested on what the catalog really says about each type.
 */
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { AgentCatalogDetail, AgentCatalogEntry, NodeAgent, NodeRuntime, WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentSetupApi } from './agent-setup';
import codexEntry from '../../../backend/registry/codex.json';
import claudeEntry from '../../../backend/registry/claude.json';

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

// The catalog's line-up: what the form offered every signed-in agent before.
const CATALOG_CODEX = [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }, { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }];
// What the device's Codex CLI says its ChatGPT sign-in can run.
const ACCOUNT_CODEX = [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }, { id: 'gpt-6-astra', label: 'GPT-6-Astra' }];

// The API detail: the registry entry, its provider reference resolved to a list.
const detailOf = (entry: object, models: { id: string; label: string }[]) => ({ ...entry, models });
const DETAILS: Record<string, unknown> = {
  codex: detailOf(codexEntry, CATALOG_CODEX),
  claude: detailOf(claudeEntry, [{ id: 'claude-opus-5', label: 'Opus 5' }]),
};
const LABELS: Record<string, string> = { codex: codexEntry.label, claude: claudeEntry.label };

async function open({ type = 'codex', runtime, editAgent, accesses = [] }: { type?: string; runtime: Partial<NodeRuntime>; editAgent?: NodeAgent; accesses?: unknown[] }) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const api = {
    getAgentCatalogDetail: vi.fn().mockResolvedValue(DETAILS[type] as AgentCatalogDetail),
    listModelAccess: vi.fn().mockResolvedValue(accesses),
    probeModelAccess: vi.fn(),
    enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'cmd1' }),
  } as unknown as AgentSetupApi;
  const node = {
    nodeId: 'n1', name: 'LAPTOP', launcherVersion: '0.2.205',
    agents: editAgent ? [editAgent] : [],
    runtimes: [{ type, installed: true, ready: true, ...runtime }],
  } as unknown as WorkspaceNode;
  await act(async () => root.render(createElement(AgentSetup, {
    node, catalog: [{ name: type, label: LABELS[type] } as AgentCatalogEntry], api,
    ...(editAgent ? { editAgent } : { initialType: type }),
    onBack: () => {}, onChanged: () => {}, onQueued: () => {},
  })));
  for (let i = 0; i < 3; i++) await act(async () => {});
  return api;
}

const modelSelect = () => [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === '__auto__')) ?? null;
const offered = () => [...modelSelect()!.options].map((o) => o.value).filter((v) => v !== '__auto__');
const accountHint = () => host.querySelector('[data-testid="agent-setup-account-models"]');
const credentials = () => [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === '__none__'))!;
const choose = async (select: HTMLSelectElement, value: string) => {
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
};
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

it('offers a new codex agent on the device sign-in the models that account can run', async () => {
  const api = await open({ runtime: { cliModels: ACCOUNT_CODEX } });
  expect(offered()).toEqual(['gpt-6.1-sol', 'gpt-6-astra']);
  expect(accountHint()?.textContent).toBe(t('connect.nodeModelAccountHint', { label: 'OpenAI Codex CLI' }));

  await choose(modelSelect()!, 'gpt-6-astra');
  await act(async () => button(messages.connect.agentAddTitle).click());
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'create_agent', expect.objectContaining({
    type: 'codex', model: 'gpt-6-astra', authMode: 'cli_login',
  }));
});

it('keeps the catalog list for a device that does not report its sign-in models', async () => {
  await open({ runtime: {} });
  expect(offered()).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna']);
  expect(accountHint()).toBeNull();
});

it('drops the sign-in list once a saved key is picked, and brings it back with the sign-in', async () => {
  const access = { id: 'acc1', label: 'My relay', provider: 'custom', apiKeyMasked: 'sk-r...9999' };
  const api = await open({ runtime: { cliModels: ACCOUNT_CODEX }, accesses: [access] });
  vi.mocked(api.probeModelAccess).mockResolvedValue({ ok: true, keyOk: true, models: [{ id: 'relay-model', label: 'relay-model' }], source: 'live' } as never);
  await choose(credentials(), 'acc1');
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(modelSelect()).toBeNull();
  expect(accountHint()).toBeNull();
  expect(host.textContent).toContain('relay-model');

  await choose(credentials(), '__none__');
  expect(offered()).toEqual(['gpt-6.1-sol', 'gpt-6-astra']);
  expect(accountHint()).not.toBeNull();
});

it('offers a new claude agent on the device sign-in the models its account can run', async () => {
  const api = await open({
    type: 'claude',
    runtime: { cliModels: [{ id: 'opus', label: 'Opus 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' }] },
  });
  // Claude has the sign-in choice too: its registry entry maps LLM_* and has a login.
  expect(credentials().selectedOptions[0].textContent).toBe(t('connect.byokDeviceSignIn', { command: 'claude auth login' }));
  expect(offered()).toEqual(['opus', 'sonnet']);
  expect(accountHint()?.textContent).toBe(t('connect.nodeModelAccountHint', { label: claudeEntry.label }));

  await choose(modelSelect()!, 'opus');
  await act(async () => button(messages.connect.agentAddTitle).click());
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'create_agent', expect.objectContaining({
    type: 'claude', model: 'opus', authMode: 'cli_login',
  }));
});

it('drops the claude sign-in list once an Anthropic key is picked', async () => {
  const access = { id: 'ant1', label: 'Anthropic', provider: 'anthropic', apiKeyMasked: 'sk-ant...9999' };
  const api = await open({ type: 'claude', runtime: { cliModels: [{ id: 'opus', label: 'Opus 5.5' }] }, accesses: [access] });
  vi.mocked(api.probeModelAccess).mockResolvedValue({ ok: true, keyOk: true, models: [{ id: 'claude-opus-5', label: 'claude-opus-5' }], source: 'live' } as never);
  await choose(credentials(), 'ant1');
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(modelSelect()).toBeNull();
  expect(accountHint()).toBeNull();
});

it('edits a signed-in agent on its own list, and still shows a saved model the list lost', async () => {
  const agent = {
    name: 'codex-1019', type: 'codex', status: 'running', model: 'gpt-5.5',
    authMode: 'cli_login', cliModels: [{ id: 'gpt-6-astra', label: 'GPT-6-Astra' }],
  } as NodeAgent;
  await open({ runtime: { cliModels: ACCOUNT_CODEX }, editAgent: agent });
  expect(offered()).toEqual(['gpt-6-astra', 'gpt-5.5']);
  expect(modelSelect()!.value).toBe('gpt-5.5');
  expect(modelSelect()!.selectedOptions[0].textContent).toBe(t('connect.nodeModelUnlisted', { model: 'gpt-5.5' }));
});

it('edits an agent on a key without the sign-in list', async () => {
  const agent = {
    name: 'codex-relay', type: 'codex', status: 'running', model: 'openai-gpt-oss-20b',
    authMode: 'api_key', apiKeyMasked: 'sk-a...cdef', baseUrlHost: 'relay.example.cn', cliModels: null,
  } as NodeAgent;
  await open({ runtime: { cliModels: ACCOUNT_CODEX }, editAgent: agent });
  // Kept on its key: the picker is the free model field for that key.
  expect(modelSelect()).toBeNull();
  expect(accountHint()).toBeNull();
});

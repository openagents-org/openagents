// @vitest-environment jsdom
/**
 * The add form as reopened from a failed add (Edit on the failed card), and the
 * two fields people missed on it: the model a saved key needs, and a name the
 * device already uses.
 */
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { AgentCatalogDetail, AgentCatalogEntry, ModelAccessEntry, WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentDraft, type AgentSetupApi } from './agent-setup';

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

const access = { id: 'acc1', label: 'OpenAgents credits', provider: 'openai', apiKeyMasked: 'sk-d...gJn4' } as ModelAccessEntry;

const deepseekDetail = { name: 'deepseek', models: [], resolve_env: { rules: [{ from: 'LLM_MODEL', to: 'DEEPSEEK_MODEL' }] } };

async function open({ draft, draftFailure, agents = [], detail = deepseekDetail, ready = true }: {
  draft: AgentDraft; draftFailure?: string; agents?: { name: string; type: string }[]; detail?: object; ready?: boolean;
}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const api = {
    getAgentCatalogDetail: vi.fn().mockResolvedValue(detail as unknown as AgentCatalogDetail),
    listModelAccess: vi.fn().mockResolvedValue([access]),
    probeModelAccess: vi.fn().mockResolvedValue({ keyOk: true, source: 'live', models: [{ id: 'deepseek-chat', label: 'deepseek-chat' }, { id: 'deepseek-reasoner', label: 'deepseek-reasoner' }] }),
    enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'cmd2' }),
  } as unknown as AgentSetupApi;
  const onQueued = vi.fn();
  const node = { nodeId: 'n1', name: 'LAPTOP', launcherVersion: '0.2.198', agents, runtimes: [{ type: draft.type, installed: true, ready }] } as unknown as WorkspaceNode;
  await act(async () => root.render(createElement(AgentSetup, {
    node, catalog: [{ name: draft.type, label: draft.type } as AgentCatalogEntry], api,
    draft, draftFailure, onBack: () => {}, onChanged: () => {}, onQueued,
  })));
  // Let the catalog detail, the saved accesses and the key's models land.
  for (let i = 0; i < 3; i++) await act(async () => {});
  return { api, onQueued };
}

const nameInput = () => host.querySelector<HTMLInputElement>(`input[aria-label="${messages.connect.nodeAgentNameLabel}"]`)!;
const addButton = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === messages.connect.agentAddTitle)!;
const alerts = () => [...host.querySelectorAll('[role="alert"]')].map((e) => e.textContent);

it('reopens a failed add as it was submitted and retries it under a new name', async () => {
  const draft = { name: 'deepseek', type: 'deepseek', modelAccessId: 'acc1', model: 'deepseek-chat' };
  const { api, onQueued } = await open({ draft, draftFailure: "Error: Agent 'deepseek' already exists\n" });

  expect(nameInput().value).toBe('deepseek');
  expect(nameInput().disabled).toBe(false);
  // The name the device refused stays flagged, though no roster here has it.
  expect(nameInput().getAttribute('aria-invalid')).toBe('true');
  expect(alerts()).toContain(t('connect.agentNameOnDevice', { name: 'deepseek' }));
  const modelSelect = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'deepseek-chat'))!;
  expect(modelSelect.value).toBe('deepseek-chat');

  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(nameInput(), 'deepseek1020');
    nameInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(nameInput().getAttribute('aria-invalid')).toBe('false');
  expect(host.textContent).toContain(messages.connect.agentNameUniqueHint);

  await act(async () => addButton().click());
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'create_agent', expect.objectContaining({
    name: 'deepseek1020', type: 'deepseek', model: 'deepseek-chat', modelAccessId: 'acc1',
  }));
  expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({
    name: 'deepseek1020', commandId: 'cmd2',
    draft: expect.objectContaining({ name: 'deepseek1020', model: 'deepseek-chat', modelAccessId: 'acc1' }),
  }));
});

it('marks the model required above the picker and says so there when it is skipped', async () => {
  const { api } = await open({ draft: { name: 'deepseek1020', type: 'deepseek', modelAccessId: 'acc1' } });

  expect(host.textContent).toContain(`${messages.connect.byokModelLabel} * ${messages.connect.requiredMark}`);
  await act(async () => addButton().click());
  expect(api.enqueueNodeCommand).not.toHaveBeenCalled();
  // Once beside the picker, once in the footer beside Add.
  expect(alerts().filter((a) => a === messages.connect.byokModelRequired)).toHaveLength(2);
});

it('says a name is taken while it is typed', async () => {
  await open({ draft: { name: 'deepseek', type: 'deepseek' }, agents: [{ name: 'deepseek', type: 'deepseek' }] });
  expect(nameInput().getAttribute('aria-invalid')).toBe('true');
  expect(alerts()).toContain(messages.connect.agentNameExists);
});

it('reopens a failed add with the agent’s own credentials it was submitted with', async () => {
  const detail = { name: 'codearts', models: [], env_config: [
    { name: 'HUAWEICLOUD_SDK_AK', password: true, required: true },
    { name: 'HUAWEICLOUD_SDK_SK', password: true, required: true },
  ] };
  const config = { HUAWEICLOUD_SDK_AK: 'ak-123', HUAWEICLOUD_SDK_SK: 'sk-456' };
  const { api, onQueued } = await open({ draft: { name: 'codearts1020', type: 'codearts', config }, detail, ready: false });

  const field = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  expect(field('HUAWEICLOUD_SDK_AK').value).toBe('ak-123');
  expect(field('HUAWEICLOUD_SDK_SK').value).toBe('sk-456');

  await act(async () => addButton().click());
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'create_agent', expect.objectContaining({ name: 'codearts1020', config }));
  // Kept again, in case this attempt fails too.
  expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ config }) }));
});

it('says Hermes and OpenClaw agents on a device share one key, endpoint and model', async () => {
  const hermesDetail = { name: 'hermes', models: [], resolve_env: { rules: [{ from: 'LLM_API_KEY', to: 'OPENAI_API_KEY' }] } };
  await open({ draft: { name: 'hermes2', type: 'hermes' }, detail: hermesDetail });
  expect(host.querySelector('[data-testid="agent-setup-shared-config"]')?.textContent).toBe(t('connect.agentSharedConfigHint', { label: 'hermes' }));
  await act(async () => root.unmount()); host.remove();
  await open({ draft: { name: 'deepseek2', type: 'deepseek' } });
  expect(host.querySelector('[data-testid="agent-setup-shared-config"]')).toBeNull();
});

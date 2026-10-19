// @vitest-environment jsdom
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { AgentCatalogDetail, AgentCatalogEntry, WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentSetupApi } from './agent-setup';

vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, params?: Record<string, string | number>) => translate(messages, messages, 'en-US', key, params) }));
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

async function open(version: string) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const agent = { name: 'coder', type: 'codex', status: 'running', model: 'test-model', baseUrlHost: 'relay.example', codexWireApi: 'chat' as const };
  const api = {
    getAgentCatalogDetail: vi.fn().mockResolvedValue({ name: 'codex', models: [], resolve_env: { rules: [{ from: 'LLM_MODEL', to: 'CODEX_MODEL' }] } } as unknown as AgentCatalogDetail),
    listModelAccess: vi.fn().mockResolvedValue([]), enqueueNodeCommand: vi.fn().mockResolvedValue({}),
  } as unknown as AgentSetupApi;
  await act(async () => root.render(createElement(AgentSetup, { node: { nodeId: 'n1', launcherVersion: version, agents: [agent], runtimes: [] } as unknown as WorkspaceNode, catalog: [{ name: "codex", label: "Codex" } as AgentCatalogEntry], api, editAgent: agent, onBack: () => {}, onChanged: () => {} })));
  const select = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'responses'))!;
  expect(select.value).toBe('chat');
  expect(host.textContent).toContain('cannot run commands');
  await act(async () => { select.value = 'responses'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const save = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === messages.connect.nodeSaveChanges)!;
  await act(async () => save.click());
  return api;
}
it('sends the selected coding mode when editing a supported device', async () => {
  const api = await open('0.2.197');
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'configure_agent', expect.objectContaining({ name: 'coder', codexWireApi: 'responses' }));
});
it('does not silently send a coding mode an older device ignores', async () => {
  const api = await open('0.2.196');
  expect(api.enqueueNodeCommand).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Update the CLI');
});

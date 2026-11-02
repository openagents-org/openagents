// @vitest-environment jsdom
/**
 * A device reports a type ready when any one of its agents is, a key that
 * agent holds included. That key is the agent's alone: a new agent, or one
 * with no key of its own, does not run on it. The form judges those on
 * `typeReady`, the type's own answer. Read off the real DeepSeek entry: a type
 * with no sign-in, so a key is the only way it is ever ready.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { AgentCatalogDetail, AgentCatalogEntry, NodeAgent, NodeRuntime, WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentSetupApi } from './agent-setup';
import deepseekEntry from '../../../backend/registry/deepseek.json';

const t = (key: string, params?: Record<string, string | number>) => translate(messages, messages, 'en-US', key, params);
vi.mock('@/lib/i18n', () => ({ useT: () => t }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });

async function open(runtime: Partial<NodeRuntime>, editAgent?: NodeAgent) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const api = {
    getAgentCatalogDetail: vi.fn().mockResolvedValue({ ...deepseekEntry, models: [] } as unknown as AgentCatalogDetail),
    listModelAccess: vi.fn().mockResolvedValue([]),
    probeModelAccess: vi.fn(),
    enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'cmd1' }),
  } as unknown as AgentSetupApi;
  const node = {
    nodeId: 'n1', name: 'LAPTOP-VON9RSJS', launcherVersion: '0.2.213',
    agents: editAgent ? [editAgent] : [],
    runtimes: [{ type: 'deepseek', installed: true, ready: false, ...runtime }],
  } as unknown as WorkspaceNode;
  await act(async () => root.render(createElement(AgentSetup, {
    node, catalog: [{ name: 'deepseek', label: deepseekEntry.label } as AgentCatalogEntry], api,
    ...(editAgent ? { editAgent } : { initialType: 'deepseek' }),
    onBack: () => {}, onChanged: () => {}, onQueued: () => {},
  })));
  for (let i = 0; i < 3; i++) await act(async () => {});
  return api;
}

const needsCredentials = () => host.querySelector('[data-testid="agent-setup-needs-credentials"]');
const saysReady = () => host.textContent!.includes(t('connect.nodeReadyHint'));
const submit = () => host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!;

it('does not offer a type as ready on a key another agent holds', async () => {
  const api = await open({ ready: true, typeReady: false });
  expect(saysReady()).toBe(false);
  expect(needsCredentials()?.textContent).toContain(t('connect.nodeNeedsKeyHint'));

  // And with no key of its own it is not added at all: DeepSeek has nothing
  // else to run on (agent-setup.key-required.test.ts).
  await act(async () => submit().click());
  await act(async () => submit().click());
  expect(api.enqueueNodeCommand).not.toHaveBeenCalled();
});

it('offers a type as ready on the device\'s own key', async () => {
  await open({ ready: true, typeReady: true });
  expect(saysReady()).toBe(true);
  expect(needsCredentials()).toBeNull();
});

it('keeps `ready` for a device too old to report typeReady', async () => {
  await open({ ready: true });
  expect(saysReady()).toBe(true);
});

it('says an agent with no key of its own is not ready on another agent\'s key', async () => {
  await open({ ready: true, typeReady: false }, {
    name: 'deepseek', type: 'deepseek', status: 'stopped', authMode: null, apiKeyMasked: null,
  } as NodeAgent);
  expect(saysReady()).toBe(false);
  expect(needsCredentials()?.textContent).toContain(t('connect.nodeNeedsKeyHint'));
});

it('says an agent on its own key is ready', async () => {
  await open({ ready: true, typeReady: false }, {
    name: 'deepseek-keyed', type: 'deepseek', status: 'running', authMode: 'api_key', apiKeyMasked: 'sk-t...1234',
  } as NodeAgent);
  expect(saysReady()).toBe(true);
  expect(needsCredentials()).toBeNull();
});

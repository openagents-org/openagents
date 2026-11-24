// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceNode } from '@/lib/types';

const opened = vi.hoisted(() => vi.fn());
const viewer = vi.hoisted(() => ({ id: 'me@x.com' }));
vi.mock('@/lib/api', () => ({ workspaceApi: {} }));
vi.mock('@/lib/desktop-host', () => ({ desktopHost: () => null }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ currentUser: viewer }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgo: () => 'now' }) }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/sharing/agent-sharing-button', () => ({ AgentSharingButton: () => null }));
vi.mock('@/components/agents/import-sessions-host', () => ({ openImportSessions: opened }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NodeCard } from './node-card';

const node = (ownerEmail: string | null): WorkspaceNode => ({
  nodeId: 'n1', name: 'Laptop', hostname: null, deviceType: 'desktop', os: null, launcherVersion: null,
  status: 'online', runtimes: [], lastHeartbeatAt: null, createdAt: null, ownerEmail,
  agents: [{ name: 'my-codex', type: 'codex', status: 'running' }, { name: 'my-aider', type: 'aider', status: 'running' }] as WorkspaceNode['agents'],
});
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  opened.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (n: WorkspaceNode) => act(() => root.render(React.createElement(NodeCard, {
  node: n, expanded: true, onExpand: () => {}, onAddAgent: () => {}, onEditAgent: () => {},
  onDismissPending: () => {}, onRetryPending: () => {}, onChanged: () => {},
})));
const buttons = () => host.querySelectorAll<HTMLButtonElement>('[data-testid="node-agent-import"]');

it('offers importing past sessions on the owner\'s rows of importable tools only', () => {
  render(node('Me@X.com'));
  expect(buttons()).toHaveLength(1);
  act(() => buttons()[0].click());
  expect(opened).toHaveBeenCalledWith('my-codex');
});

it('does not offer it on someone else\'s device', () => {
  render(node('other@x.com'));
  expect(buttons()).toHaveLength(0);
  render(node(null));
  expect(buttons()).toHaveLength(0);
});

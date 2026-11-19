// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceNode } from '@/lib/types';
import { useConnectRequests } from './use-connect-requests';

const layout = vi.hoisted(() => ({
  addAgentPending: false,
  consumeAddAgent: vi.fn(),
  editAgentPending: null as null | { agentName: string; nodeId: string },
  consumeEditAgent: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => layout }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast }));

const node = (agents: string[]): WorkspaceNode => ({
  nodeId: 'n1', name: 'Laptop', hostname: null, deviceType: 'desktop', os: null, launcherVersion: null,
  status: 'online', runtimes: [], lastHeartbeatAt: null, createdAt: null,
  agents: agents.map((name) => ({ name, type: 'codex', status: 'running' })) as WorkspaceNode['agents'],
});

let root: Root;
let container: HTMLDivElement;
const openEditor = vi.fn();
const openGallery = vi.fn();

function Harness({ nodes, onRefresh }: { nodes: WorkspaceNode[]; onRefresh: () => Promise<void> }) {
  useConnectRequests({ nodes, loaded: true, localNodeId: null, onRefresh, openGallery, openEditor });
  return null;
}

beforeEach(() => {
  layout.editAgentPending = { agentName: 'codex-new', nodeId: 'n1' };
  layout.consumeEditAgent.mockReset();
  toast.error.mockReset();
  openEditor.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('refetches a list that predates the agent, then opens its form', async () => {
  let rerender: () => void = () => {};
  const onRefresh = vi.fn(async () => { rerender(); });
  rerender = () => root.render(React.createElement(Harness, { nodes: [node(['codex-new'])], onRefresh }));
  await act(async () => { root.render(React.createElement(Harness, { nodes: [node([])], onRefresh })); });

  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(openEditor).toHaveBeenCalledWith('n1', expect.objectContaining({ name: 'codex-new' }));
  expect(toast.error).not.toHaveBeenCalled();
});

it("says so when the agent's device is not one of this person's connections", async () => {
  const onRefresh = vi.fn(async () => {});
  await act(async () => { root.render(React.createElement(Harness, { nodes: [], onRefresh })); });

  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(openEditor).not.toHaveBeenCalled();
  expect(layout.consumeEditAgent).toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith('connect.agentOnOtherConnection');
});

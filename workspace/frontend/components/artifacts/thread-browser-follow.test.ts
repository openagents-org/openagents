// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { type ArtifactReference, openArtifactPreview } from '@/lib/thread-artifacts';
const mocks = vi.hoisted(() => ({
  workspace: { workspace: { workspaceId: 'w' }, currentSessionId: 'one', currentUser: { id: 'me' }, loading: false, files: [], browserTabs: [] as any[] },
  layout: { viewMode: 'threads', isMobile: false, selectedArtifact: null as ArtifactReference | null, showBrowserPreview: false, openArtifact: vi.fn(), setSelectedArtifact: vi.fn(), setShowBrowserPreview: vi.fn(), setSplitBrowser: vi.fn() },
  get: vi.fn(),
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => mocks.workspace }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => mocks.layout }));
vi.mock('@/lib/api', () => ({ workspaceApi: { getThreadArtifact: mocks.get } }));
import { useThreadArtifactPreview } from './thread-artifact-controller';
function Controller() { useThreadArtifactPreview(); return null; }
let root: Root, host: HTMLDivElement;
const render = async () => { await act(async () => root.render(React.createElement(Controller))); };
const tab = (id = 'xe', channels = ['one']) => ({ id, artifactChannels: channels, status: 'active', createdBy: 'human:user', url: 'https://www.xe.com', lastActiveAt: '2026-10-14T18:27:00Z' });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  mocks.workspace.currentSessionId = 'one'; mocks.workspace.browserTabs = [];
  mocks.layout.viewMode = 'threads'; mocks.layout.isMobile = false;
  mocks.layout.selectedArtifact = null; mocks.layout.showBrowserPreview = false;
  mocks.layout.openArtifact.mockImplementation((artifact: ArtifactReference) => { mocks.layout.selectedArtifact = artifact; mocks.layout.showBrowserPreview = true; });
  mocks.layout.setSelectedArtifact.mockImplementation(value => { mocks.layout.selectedArtifact = value; });
  mocks.layout.setShowBrowserPreview.mockImplementation(value => { mocks.layout.showBrowserPreview = value; });
  mocks.get.mockResolvedValue({ artifact: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('leaves linked live tabs to the compact thread preview instead of opening the full panel', async () => {
  mocks.workspace.browserTabs = [tab()]; await render(); await render();
  mocks.workspace.browserTabs = [tab(), tab('new')]; await render();
  expect(mocks.layout.openArtifact).not.toHaveBeenCalled();
});
it('still opens manually selected browser previews', async () => {
  mocks.workspace.browserTabs = [tab()]; await render();
  await act(async () => openArtifactPreview({ kind: 'browser', id: 'xe' }));
  expect(mocks.layout.openArtifact).toHaveBeenCalledWith({ kind: 'browser', id: 'xe' });
});
it('still restores pinned artifacts and protects manual choices from delayed responses', async () => {
  mocks.get.mockResolvedValueOnce({ artifact: { kind: 'file', id: 'pin' } });
  await render();
  expect(mocks.layout.openArtifact).toHaveBeenCalledWith({ kind: 'file', id: 'pin' });
  let resolve: (value: any) => void = () => {};
  mocks.get.mockReturnValue(new Promise(r => { resolve = r; }));
  mocks.workspace.currentSessionId = 'two'; await render();
  await act(async () => openArtifactPreview({ kind: 'browser', id: 'xe' }));
  await act(async () => resolve({ artifact: { kind: 'file', id: 'late-pin' } }));
  expect(mocks.layout.openArtifact).toHaveBeenLastCalledWith({ kind: 'browser', id: 'xe' });
});

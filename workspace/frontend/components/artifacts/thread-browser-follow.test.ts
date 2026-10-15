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
it('opens the linked session without legacy creator/activity metadata and only once across navigation', async () => {
  mocks.workspace.browserTabs = [tab()]; await render(); await render();
  mocks.workspace.browserTabs = [{ ...tab(), url: 'https://www.xe.com/currencyconverter/' }]; await render();
  expect(mocks.layout.openArtifact.mock.calls).toEqual([[{ kind: 'browser', id: 'xe' }]]);
});
it('opens newly linked tabs from polling, never unrelated or closed tabs', async () => {
  mocks.workspace.browserTabs = [tab('unlinked', []), tab('other', ['two']), tab('previous', ['two', 'one']), { ...tab('closed'), status: 'closed' }];
  await render(); expect(mocks.layout.openArtifact).not.toHaveBeenCalled();
  mocks.workspace.browserTabs = [...mocks.workspace.browserTabs, tab()]; await render();
  expect(mocks.layout.openArtifact).toHaveBeenCalledWith({ kind: 'browser', id: 'xe' });
});
it('respects dismissal and manual selection until reentering the thread', async () => {
  mocks.workspace.browserTabs = [tab()]; await render(); await render();
  mocks.layout.showBrowserPreview = false; await render();
  mocks.workspace.browserTabs = [tab(), tab('new')]; await render();
  expect(mocks.layout.openArtifact).toHaveBeenCalledTimes(1);
  mocks.workspace.currentSessionId = 'two'; await render();
  mocks.workspace.currentSessionId = 'one'; await render(); await render();
  expect(mocks.layout.openArtifact).toHaveBeenCalledTimes(2);
  await act(async () => openArtifactPreview({ kind: 'file', id: 'report' }));
  mocks.workspace.browserTabs = [tab('another')]; await render();
  expect(mocks.layout.openArtifact).toHaveBeenLastCalledWith({ kind: 'file', id: 'report' });
  expect(mocks.layout.openArtifact).toHaveBeenCalledTimes(3);
});
it('keeps the newest live tab over a delayed pinned-artifact response', async () => {
  let resolve: (value: any) => void = () => {};
  mocks.get.mockReturnValue(new Promise(r => { resolve = r; }));
  mocks.workspace.browserTabs = [tab('old'), { ...tab('new'), lastActiveAt: '2026-10-14T18:28:00Z' }]; await render();
  await act(async () => resolve({ artifact: { kind: 'file', id: 'pin' } }));
  expect(mocks.layout.openArtifact.mock.calls).toEqual([[{ kind: 'browser', id: 'new' }]]);
});
it('does not open in Files or replace a mobile conversation', async () => {
  mocks.workspace.browserTabs = [tab()]; mocks.layout.viewMode = 'files'; await render();
  expect(mocks.layout.openArtifact).not.toHaveBeenCalled();
  mocks.layout.viewMode = 'threads'; mocks.layout.isMobile = true; await render();
  expect(mocks.layout.openArtifact).not.toHaveBeenCalled();
});

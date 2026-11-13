// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ files: [] as { id: string; filename: string; contentType: string }[], refresh: vi.fn() }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ files: mocks.files, refreshFiles: mocks.refresh }) }));
vi.mock('@/lib/api', () => ({ workspaceApi: { downloadFile: vi.fn() } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/sharing/copy-resource-link', () => ({ CopyResourceLink: () => React.createElement('button', { 'aria-label': 'copy-link' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
import { ArtifactFileActions } from './artifact-file-actions';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.files = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = () => act(async () => root.render(React.createElement(ArtifactFileActions, { artifact: { kind: 'file', id: 'report' } })));
const download = () => host.querySelector('[aria-label="common.download"]');

it('offers download and link while a just-made file is still being listed', async () => {
  let finish!: () => void;
  mocks.refresh.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  await render();
  expect(download()).not.toBeNull();
  expect(host.querySelector('[aria-label="copy-link"]')).not.toBeNull();
  // The list arrives with the file: the actions stay. Sharing is the panel's
  // Share button (artifact-share-button.tsx), not one of these.
  mocks.files = [{ id: 'report', filename: 'report.pdf', contentType: 'application/pdf' }];
  await act(async () => finish());
  await render();
  expect(download()).not.toBeNull();
  expect(host.querySelector('[aria-label="share"]')).toBeNull();
});

it('drops the actions once a fresh list still lacks the file (deleted, trashed or not shared)', async () => {
  mocks.refresh.mockResolvedValue(undefined);
  await render();
  expect(download()).toBeNull();
  expect(host.querySelector('[aria-label="copy-link"]')).toBeNull();
});

it('keeps the actions when the refresh itself fails', async () => {
  mocks.refresh.mockRejectedValue(new Error('offline'));
  await render();
  expect(download()).not.toBeNull();
});

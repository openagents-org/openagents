// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./mermaid-block', () => ({ MermaidBlock: () => null }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: 'viewer-token' }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
import { MarkdownContent } from './markdown-content';
import { workspaceApi } from '@/lib/api';

const id = 'fb44d8ef-692a-41a6-af91-f559a1b8ddd6';
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn();
const revoke = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:authenticated-image');
    static revokeObjectURL = revoke;
  });
  fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['image bytes'], { type: 'image/png' }) });
  workspaceApi.configure('workspace', '', 'viewer-token');
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  workspaceApi.configure('', '', ''); vi.unstubAllGlobals();
});
async function render(src: string) {
  await act(async () => root.render(React.createElement(MarkdownContent, {
    content: `![OpenReview homepage](${src} "Screenshot")`, agentNames: [],
  })));
}

it.each([id, `/v1/files/${id}`, `${window.location.origin}/v1/files/${id}?download=true`])('loads workspace Markdown image %s with viewer authentication', async src => {
  await render(src);
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toContain(`/v1/files/${id}`);
  expect(url).not.toContain('viewer-token');
  expect(options.headers.Authorization).toBe('Bearer viewer-token');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:authenticated-image');
  expect(host.querySelector('img')?.alt).toBe('OpenReview homepage');
  expect(host.querySelector('img')?.title).toBe('Screenshot');
  await act(async () => root.render(null));
  expect(revoke).toHaveBeenCalledWith('blob:authenticated-image');
});

it('leaves external images alone, even when their path resembles a workspace file', async () => {
  const src = `https://images.example.org/v1/files/${id}`;
  await render(src);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(host.querySelector('img')?.getAttribute('src')).toBe(src);
});

it('shows the file failure state when access is denied', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 403 });
  await render(id);
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe('files.loadFailed');
});

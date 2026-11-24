// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
vi.mock('@/lib/i18n', () => ({ useT: () => t, useFormatters: () => ({ weekdayLabels: () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }) }));
vi.mock('@/components/chat/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => React.createElement('div', { 'data-testid': 'markdown' }, content),
}));

import { ShareArtifactViewer, ShareResourceShelf, type ShareSelection } from './share-resources';
import { RESOURCES_POLL_MS, useShareResources } from './use-share-resources';
import type { ShareResourceSource, ShareResources } from '@/lib/share-resources';

let host: HTMLDivElement;
let root: Root;

function source(files: Record<string, { body: string; type: string }> = {}): ShareResourceSource & { fetchFile: ReturnType<typeof vi.fn>; fetchResources: ReturnType<typeof vi.fn> } {
  return {
    key: 'test',
    fetchResources: vi.fn(async () => RESOURCES),
    fetchFile: vi.fn(async (id: string) => new Response(files[id]?.body ?? 'x', { status: 200, headers: { 'Content-Type': files[id]?.type ?? 'application/octet-stream' } })),
    fetchScreenshot: vi.fn(async () => new Response('jpeg', { status: 200, headers: { 'Content-Type': 'image/jpeg' } })),
  } as never;
}

const RESOURCES: ShareResources = {
  files: [
    { id: 'md', name: 'notes.md', path: 'notes.md', contentType: 'text/markdown', size: 10, createdAt: null, uploadedBy: 'openagents:coder' },
    { id: 'zip', name: 'bundle.zip', path: 'out/bundle.zip', contentType: 'application/zip', size: 10, createdAt: null, uploadedBy: 'human' },
  ],
  browsers: [{ id: 'b1', title: 'Docs', url: 'https://example.com/docs' }],
  routines: [
    { id: 'r1', name: 'Morning digest', status: 'active', scheduleHour: 9, scheduleMinute: 0, scheduleDays: null, scheduleIntervalMinutes: null, timezone: 'UTC', nextFiresAt: null, lastFiredAt: null },
    { id: 'r2', name: 'Paused job', status: 'paused', scheduleHour: 1, scheduleMinute: 0, scheduleDays: null, scheduleIntervalMinutes: 30, timezone: 'UTC', nextFiresAt: null, lastFiredAt: null },
  ],
};
const AGENTS = [{ name: 'coder', displayName: 'Claude Code', type: 'claude', online: true }];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let n = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

it('shows artifacts, agents and routines like the workspace shelf, and opens a tile', async () => {
  const onOpen = vi.fn();
  await act(async () => root.render(React.createElement(ShareResourceShelf, { resources: RESOURCES, agents: AGENTS, source: source(), selected: null, onOpen })));
  const tabs = [...host.querySelectorAll('[role="tab"]')].map((el) => el.textContent);
  expect(tabs).toEqual(['artifactPanel.title3', 'threadResources.agents1', 'routines.title2']);
  expect([...host.querySelectorAll('[aria-label="artifactPanel.title"] li')].map((li) => li.textContent?.trim())).toEqual(['threadResources.liveBrowserDocs', 'MDnotes.md', 'ZIPbundle.zip']);
  await act(async () => { ([...host.querySelectorAll('li button')].find((b) => b.textContent?.includes('notes.md')) as HTMLElement).click(); });
  expect(onOpen).toHaveBeenCalledWith({ kind: 'file', id: 'md', name: 'notes.md', contentType: 'text/markdown', size: 10 });

  const routinesTab = [...host.querySelectorAll('[role="tab"]')][2] as HTMLElement;
  await act(async () => { routinesTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); routinesTab.click(); });
  const routines = [...host.querySelectorAll('[data-routine-tile]')].map((el) => el.textContent);
  expect(routines).toEqual(['Morning digestroutines.dailyAt:{"time":"09:00 UTC"}', 'Paused jobroutines.paused']);
  // Read-only: no buttons on routine tiles.
  expect(host.querySelector('[data-routine-tile] button')).toBeNull();
});

it('stays hidden while the thread has no artifacts or routines', async () => {
  await act(async () => root.render(React.createElement(ShareResourceShelf, { resources: { files: [], browsers: [], routines: [] }, agents: AGENTS, source: source(), selected: null, onOpen: vi.fn() })));
  expect(host.querySelector('[data-share-resources]')).toBeNull();
});

async function view(selection: ShareSelection, files: Record<string, { body: string; type: string }>) {
  const src = source(files);
  await act(async () => root.render(React.createElement(ShareArtifactViewer, { source: src, selection, onClose: vi.fn() })));
  await settle();
  return src;
}

it('renders markdown with the workspace viewer', async () => {
  await view({ kind: 'file', id: 'md', name: 'notes.md', contentType: 'text/markdown' }, { md: { body: '# Hello', type: 'text/markdown' } });
  expect(host.querySelector('[data-testid="markdown"]')?.textContent).toBe('# Hello');
});

it('renders an HTML page in a scripts-only sandbox, never same-origin', async () => {
  await view({ kind: 'file', id: 'page', name: 'page.html', contentType: 'text/html' }, { page: { body: '<h1>Hi</h1>', type: 'text/html' } });
  const frame = host.querySelector('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  expect(frame.getAttribute('srcdoc')).toBe('<h1>Hi</h1>');
  expect(frame.getAttribute('src')).toBeNull();
});

it('shows an image from a blob URL', async () => {
  await view({ kind: 'file', id: 'img', name: 'chart.png', contentType: 'image/png' }, { img: { body: 'png', type: 'image/png' } });
  expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
});

it('offers a download for anything it can’t show', async () => {
  const src = await view({ kind: 'file', id: 'zip', name: 'bundle.zip', contentType: 'application/zip' }, { zip: { body: 'PK', type: 'application/zip' } });
  const fallback = host.querySelector('[data-artifact-download]')!;
  expect(fallback.textContent).toContain('bundle.zip');
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await act(async () => { (fallback.querySelector('button') as HTMLElement).click(); });
  await settle();
  expect(src.fetchFile).toHaveBeenCalledTimes(2);
  expect(click).toHaveBeenCalled();
  click.mockRestore();
});

it('shows a browser session as a view-only screenshot', async () => {
  const src = await view({ kind: 'browser', id: 'b1', title: 'Docs', url: 'https://example.com/docs' }, {});
  expect(src.fetchScreenshot).toHaveBeenCalledWith('b1', expect.anything());
  expect(host.querySelector('[data-share-viewer="browser"] img')?.getAttribute('src')).toMatch(/^blob:/);
  expect(host.querySelector('[data-share-download]')).toBeNull();
});

it('polls resources every 15s and again when the thread moves on', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const src = source();
  let seen: ShareResources | null = null;
  function Probe({ bump }: { bump: number }) { seen = useShareResources(src, bump); return null; }
  await act(async () => root.render(React.createElement(Probe, { bump: 0 })));
  await settle();
  expect(src.fetchResources).toHaveBeenCalledTimes(1);
  expect(seen!.files).toHaveLength(2);
  await act(async () => { vi.advanceTimersByTime(RESOURCES_POLL_MS); });
  await settle();
  expect(src.fetchResources).toHaveBeenCalledTimes(2);
  await act(async () => root.render(React.createElement(Probe, { bump: 1 })));
  await settle();
  expect(src.fetchResources).toHaveBeenCalledTimes(3);
});

it('names agents by their handle, with the runtime as a secondary label', async () => {
  await act(async () => root.render(React.createElement(ShareResourceShelf, { resources: RESOURCES, agents: [{ name: 'pr-reviewer', displayName: 'PR Reviewer', type: 'claude', online: true }], source: source(), selected: null, onOpen: vi.fn() })));
  const agentsTab = [...host.querySelectorAll('[role="tab"]')][1] as HTMLElement;
  await act(async () => { agentsTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); agentsTab.click(); });
  const tile = host.querySelector('[data-agent-tile="pr-reviewer"]')!;
  expect(tile.textContent).toBe('pr-reviewerClaude Code · guestThread.online');
});

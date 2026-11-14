// @vitest-environment jsdom
import React, { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// A stable translator, as the real one is: the page reloads when it changes.
const t = (key: string) => key;
const formatters = { formatDate: () => 'D', formatDateTime: () => 'DT', formatFileSize: () => '1 KB' };
vi.mock('@/lib/i18n', () => ({ useT: () => t, useFormatters: () => formatters }));
vi.mock('@/lib/api-base', () => ({ getApiBaseUrl: () => 'https://api.test' }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => React.createElement('img', { alt: props.alt }) }));
vi.mock('@/components/chat/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => React.createElement('div', { 'data-testid': 'markdown' }, content),
}));

import SharedArtifactPage from './page';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function serve(info: Record<string, unknown> | null, content = '', message = '') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/content')) return new Response(content, { status: 200 });
    return new Response(JSON.stringify(info ? { code: 0, data: info } : { code: 404, message }), { status: info ? 200 : 404 });
  }));
}

const base = { kind: 'file', title: 'x', filename: 'x', content_type: 'text/plain', size: 10, shared_at: null, expires_at: null, web_project: false, render_url: null };

async function open(token = 'tok') {
  // Already settled, the way React tracks a resolved promise, so use() reads it without suspending.
  const params = Object.assign(Promise.resolve({ token }), { status: 'fulfilled', value: { token } });
  await act(async () => root.render(React.createElement(Suspense, { fallback: null }, React.createElement(SharedArtifactPage, { params }))));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

it('points the images a shared document embeds at their public copies', async () => {
  serve({ ...base, kind: 'knowledge', title: 'Plan', content_type: 'text/markdown' }, '![c](oa-share-asset:0) and ![d](oa-share-asset:1)');
  await open();
  expect(host.querySelector('[data-testid="markdown"]')!.textContent)
    .toBe('![c](https://api.test/v1/public/shares/tok/assets/0) and ![d](https://api.test/v1/public/shares/tok/assets/1)');
});

it('renders a CSV as a table', async () => {
  serve({ ...base, title: 'q3.csv', content_type: 'text/csv' }, 'name,revenue\nacme,10\n');
  await open();
  expect([...host.querySelectorAll('th')].map(th => th.textContent)).toContain('revenue');
  expect(host.querySelector('td[title="acme"]')).not.toBeNull();
});

it('frames a web page from the share domain under a user-content banner', async () => {
  serve({ ...base, title: 'page.html', content_type: 'text/html', render_url: 'https://oa-share.test/v1/public/shares/tok/site/index.html' });
  await open();
  const frame = host.querySelector('iframe')!;
  expect(frame.getAttribute('src')).toBe('https://oa-share.test/v1/public/shares/tok/site/index.html');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(host.querySelector('[data-testid="shared-user-content"]')).not.toBeNull();
});

it('shows HTML as source when there is no share domain', async () => {
  serve({ ...base, title: 'page.html', content_type: 'text/html' }, '<b>hi</b>');
  await open();
  expect(host.querySelector('iframe')).toBeNull();
  expect(host.querySelector('pre')!.textContent).toBe('<b>hi</b>');
});

it('says when a link has expired', async () => {
  serve(null, '', 'This link has expired');
  await open();
  expect(host.textContent).toContain('sharedFile.expired');
});

it('sends a link handed out here on to the share domain', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, origin: 'https://workspace.test', replace });
  serve({ ...base, title: 'a.png', content_type: 'image/png', public_url: 'https://oa-share.test/tok' });
  await open();
  expect(replace).toHaveBeenCalledWith('https://oa-share.test/tok');
});

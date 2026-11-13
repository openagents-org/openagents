// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
  useFormatters: () => ({ formatDate: (d: string) => `date(${d.slice(0, 10)})`, formatDateTime: (d: string) => `time(${d})` }),
}));
vi.mock('@/lib/api', () => ({ workspaceApi: { getPublicShare: mocks.get, createPublicShare: mocks.create, revokePublicShare: mocks.revoke } }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: vi.fn(), warning: vi.fn() } }));

import { PublicLinkSection, expiryTimestamp } from './public-link-section';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const writeText = vi.fn(async () => {});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  for (const m of Object.values(mocks)) m.mockReset();
  writeText.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = async (props: React.ComponentProps<typeof PublicLinkSection>) => {
  await act(async () => root.render(React.createElement(PublicLinkSection, props)));
};
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;

it('creates a link that never expires by default and copies it', async () => {
  mocks.get.mockResolvedValue({ link: null, can_manage: true });
  mocks.create.mockResolvedValue({ link: { active: true, token: 'tok-1', created_at: null, snapshot_at: null, expires_at: null }, can_manage: true });
  await render({ kind: 'knowledge', id: 'k1' });
  expect(host.querySelector('[data-testid="public-link-expiry"]')).not.toBeNull();
  await act(async () => button('artifactAccess.linkCreate').click());
  expect(mocks.create).toHaveBeenCalledWith('knowledge', 'k1', null);
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/share\/artifact\/tok-1$/));
});

it('shows the snapshot and expiry of a live link, and updating keeps its expiry date', async () => {
  const expires = new Date(2030, 0, 15, 12).toISOString();
  mocks.get.mockResolvedValue({ link: { active: true, token: 'tok-2', created_at: null, snapshot_at: '2026-11-13T00:00:00Z', expires_at: expires }, can_manage: true });
  mocks.create.mockResolvedValue({ link: { active: true, token: 'tok-2', created_at: null, snapshot_at: '2026-11-14T00:00:00Z', expires_at: expires }, can_manage: true });
  await render({ kind: 'file', id: 'f1' });
  const status = host.querySelector('[data-testid="public-link-status"]')!.textContent!;
  expect(status).toContain('artifactAccess.linkSnapshot');
  expect(status).toContain('artifactAccess.linkExpiresOn');
  await act(async () => button('artifactAccess.linkUpdate').click());
  expect(mocks.create).toHaveBeenCalledWith('file', 'f1', new Date(2030, 0, 15, 23, 59, 59).toISOString());
  expect(mocks.success).toHaveBeenCalledWith('artifactAccess.linkUpdated');
});

it('tells someone who cannot manage it only that a link exists', async () => {
  mocks.get.mockResolvedValue({ link: { active: true, created_at: null, snapshot_at: null, expires_at: null }, can_manage: false });
  await render({ kind: 'file', id: 'f1' });
  expect(host.textContent).toContain('artifactAccess.linkActiveReadOnly');
  expect(button('artifactAccess.linkCopy')).toBeUndefined();
});

it('turns an expiry choice into a timestamp', () => {
  const now = new Date('2026-11-13T10:00:00Z');
  expect(expiryTimestamp('never', '', now)).toBeNull();
  expect(expiryTimestamp('7', '', now)).toBe('2026-11-20T10:00:00.000Z');
  expect(expiryTimestamp('custom', '2026-12-01', now)).toBe(new Date(2026, 11, 1, 23, 59, 59).toISOString());
  expect(expiryTimestamp('custom', '', now)).toBeNull();
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'oa-ws' }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ user: { email: 't@x.org' }, idToken: 'id', loading: false, signIn: vi.fn() }) }));
vi.mock('@/lib/account-api', () => ({ listHubCredentials: mocks.list, createHubApiKey: mocks.create, revokeHubCredential: mocks.revoke }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/auth-redirects', () => ({ goToCentralLogin: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, p?: Record<string, string>) => translate(messages, messages, 'en-US', key, p) }));

import ConnectedAppsPage from './page';

const base = { connected_apps: [], mcp_url: 'https://mcp.openagents.org/mcp', docs_url: 'https://mcp.openagents.org/v1/hub/docs', skill_url: 'https://mcp.openagents.org/v1/hub/skill.zip' };
const existingKey = { id: 'k1', name: 'API key', prefix: 'oa_pk_abcd', created_at: '2026-11-13T00:00:00Z', last_used_at: null };
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.list.mockReset().mockResolvedValue({ ...base, api_keys: [] });
  mocks.create.mockReset().mockResolvedValue({ ...existingKey, key: 'oa_pk_secret' });
  mocks.confirm.mockReset().mockResolvedValue(true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = () => act(async () => root.render(createElement(ConnectedAppsPage)));
const tab = (label: string) => [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === label) as HTMLButtonElement;
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

it('offers each supported app and shows the connector URL for ChatGPT first', async () => {
  await render();
  expect([...host.querySelectorAll('[role="tab"]')].map((b) => b.textContent)).toEqual(['ChatGPT', 'Claude', 'Muse', 'Claude Code · Codex', 'Slack', 'Lark']);
  expect(host.querySelector('[role="tabpanel"]')!.textContent).toContain('https://mcp.openagents.org/mcp');
});

it('creates the key in one click for Muse and puts it in the instructions', async () => {
  await render();
  await act(async () => tab('Muse').click());
  await act(async () => button('Create API key').click());
  expect(mocks.create).toHaveBeenCalledWith('id', { replace: false });
  const panel = host.querySelector('[role="tabpanel"]')!.textContent!;
  expect(panel).toContain('oa_pk_secret');
  expect(panel).toContain('Read https://mcp.openagents.org/v1/hub/docs');
});

it('regenerates an existing key after confirmation', async () => {
  mocks.list.mockResolvedValue({ ...base, api_keys: [existingKey] });
  await render();
  await act(async () => tab('Claude Code · Codex').click());
  await act(async () => button('Regenerate').click());
  expect(mocks.confirm).toHaveBeenCalled();
  expect(mocks.create).toHaveBeenCalledWith('id', { replace: true });
});

it('sends Slack and Lark to the workspace integrations', async () => {
  await render();
  await act(async () => tab('Slack').click());
  expect(host.querySelector('[role="tabpanel"] a')!.getAttribute('href')).toBe('/oa-ws/settings/integrations');
  await act(async () => tab('Lark').click());
  expect(host.querySelector('[role="tabpanel"]')!.textContent).toContain('App ID');
});

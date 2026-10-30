// @vitest-environment jsdom
/**
 * The hint on an agent installed with no credentials: an API key always works,
 * and an agent whose CLI signs in to an account can also be signed in on its
 * device — in the desktop app, or with a command for a device paired from the
 * command line. That command is `agn login <type>` when the device says it has
 * it, else the CLI's own. Read off the real registry entries.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { AgentCatalogDetail, AgentCatalogEntry, NodeRuntime, WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentSetupApi } from './agent-setup';
import codexEntry from '../../../backend/registry/codex.json';
import openclawEntry from '../../../backend/registry/openclaw.json';
import opencodeEntry from '../../../backend/registry/opencode.json';

const t = (key: string, params?: Record<string, string | number>) => translate(messages, messages, 'en-US', key, params);
vi.mock('@/lib/i18n', () => ({ useT: () => t }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  delete (window as { __oaHost__?: unknown }).__oaHost__;
});

const ENTRIES: Record<string, { label: string }> = { codex: codexEntry, openclaw: openclawEntry, opencode: opencodeEntry };

async function open(type: string, runtime: Partial<NodeRuntime> = {}, os: string | null = null) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const api = {
    getAgentCatalogDetail: vi.fn().mockResolvedValue({ ...ENTRIES[type], models: [] } as unknown as AgentCatalogDetail),
    listModelAccess: vi.fn().mockResolvedValue([]),
    probeModelAccess: vi.fn(),
    enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'cmd1' }),
  } as unknown as AgentSetupApi;
  const node = {
    nodeId: 'n1', name: 'racknerd-363e14e', os, agents: [],
    runtimes: [{ type, installed: true, ready: false, ...runtime }],
  } as unknown as WorkspaceNode;
  await act(async () => root.render(createElement(AgentSetup, {
    node, catalog: [{ name: type, label: ENTRIES[type].label } as AgentCatalogEntry], api,
    initialType: type, onBack: () => {}, onChanged: () => {}, onQueued: () => {},
  })));
  for (let i = 0; i < 3; i++) await act(async () => {});
  return api;
}

const hint = () => host.querySelector('[data-testid="agent-setup-needs-credentials"]')!;
const downloads = () => [...hint().querySelectorAll('a')].map((a) => a.getAttribute('href'));

it('offers a key, the desktop app, and agn login on a device that has it', async () => {
  await open('codex', { loginCommand: 'agn login codex' });
  const text = hint().textContent!;
  expect(text).toContain(t('connect.nodeNeedsLoginHint'));
  expect(text).toContain(t('connect.nodeNeedsLoginKeyStep'));
  expect(text).toContain(t('connect.nodeNeedsLoginDesktop', { device: 'racknerd-363e14e', label: codexEntry.label }));
  expect(hint().querySelector('code')!.textContent).toBe('agn login codex');
  expect(downloads()).toEqual([
    'https://openagents.org/api/download/launcher/mac',
    'https://openagents.org/api/download/launcher/mac-intel',
    'https://openagents.org/api/download/launcher/windows',
  ]);
});

it("falls back to the CLI's own login on a device too old for agn login", async () => {
  await open('codex');
  expect(hint().querySelector('code')!.textContent).toBe('codex login');
  // A sign-in agent: the form below offers its device sign-in.
  expect(host.querySelector('[data-testid="agent-setup-signin-hint"]')).not.toBeNull();
});

it('offers only a key for an agent with no sign-in of its own', async () => {
  await open('openclaw');
  const text = hint().textContent!;
  expect(text).toContain(t('connect.nodeNeedsKeyHint'));
  expect(text).not.toContain(t('connect.nodeNeedsLoginSubTitle'));
  expect(hint().querySelector('code')).toBeNull();
});

it('does not offer the desktop app download inside the desktop app', async () => {
  (window as { __oaHost__?: unknown }).__oaHost__ = {};
  await open('codex', { loginCommand: 'agn login codex' });
  expect(hint().textContent).toContain(t('connect.nodeNeedsLoginDesktop', { device: 'racknerd-363e14e', label: codexEntry.label }));
  expect(downloads()).toEqual([]);
});

it('names the OpenCode sign-in without treating OpenCode as a sign-in agent', async () => {
  await open('opencode');
  const text = hint().textContent!;
  expect(text).toContain(t('connect.nodeNeedsLoginSubTitle'));
  expect(text).toContain(t('connect.nodeNeedsLoginOpencodeNote'));
  expect(hint().querySelector('code')!.textContent).toBe('opencode auth login');
  // The registry still gives it no login command, so the form below is as it
  // was: no "sign in on the device" choice and its hint.
  expect(host.querySelector('[data-testid="agent-setup-signin-hint"]')).toBeNull();
  expect(host.textContent).not.toContain('(opencode auth login)');
});

it('shows agn login for OpenCode on a device that reports it', async () => {
  await open('opencode', { loginCommand: 'agn login opencode' });
  expect(hint().querySelector('code')!.textContent).toBe('agn login opencode');
});

const notFound = () => host.querySelector('[data-testid="agent-setup-cli-not-found"]');
const notFoundCodes = () => [...notFound()!.querySelectorAll('code')].map((c) => c.textContent);

it('tells an older Windows device how to run the CLI when it is not on PATH', async () => {
  await open('opencode', {}, 'win32');
  expect(notFound()!.textContent).toContain(opencodeEntry.label);
  expect(notFoundCodes()).toEqual(['agn runtimes', '& "<path>" auth login']);
});

it('gives the POSIX form off Windows', async () => {
  await open('codex', {}, 'linux');
  expect(notFoundCodes()).toEqual(['agn runtimes', '"<path>" login']);
});

it('needs no such line where agn login finds the CLI itself', async () => {
  await open('codex', { loginCommand: 'agn login codex' }, 'win32');
  expect(notFound()).toBeNull();
});

const notSignedIn = () => host.querySelector('[data-testid="agent-setup-not-signed-in"]');

const submit = async () => {
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!.click(); });
  for (let i = 0; i < 3; i++) await act(async () => {});
};
const created = (api: AgentSetupApi) => (api.enqueueNodeCommand as ReturnType<typeof vi.fn>).mock.calls
  .filter((c) => c[1] === 'create_agent');

it('warns, then lets the agent be added anyway when nothing is signed in and no key is picked', async () => {
  const api = await open('codex');
  const button = () => host.querySelector<HTMLButtonElement>('[data-testid="agent-setup-submit"]')!;
  expect(notSignedIn()!.textContent).toContain(t('connect.byokNotSignedInRequired'));
  expect(notSignedIn()!.getAttribute('role')).toBeNull();
  expect(button().disabled).toBe(false);
  expect(button().textContent).toBe(t('connect.agentAddTitle'));
  // The first click points at the warning instead of adding.
  await submit();
  expect(created(api)).toEqual([]);
  expect(notSignedIn()!.getAttribute('role')).toBe('alert');
  expect(button().textContent).toBe(t('connect.agentAddAnyway'));
  // The second adds it, on the device's sign-in to be done later.
  await submit();
  expect(created(api)).toHaveLength(1);
});

it('shows agn login in the sign-in choice and its hint on a device that has it', async () => {
  await open('codex', { loginCommand: 'agn login codex' });
  expect(host.querySelector('[data-testid="agent-setup-signin-hint"]')!.textContent)
    .toContain(t('connect.byokDeviceSignInHint', { label: codexEntry.label, command: 'agn login codex' }));
  expect(host.textContent).toContain(t('connect.byokDeviceSignIn', { command: 'agn login codex' }));
  expect(host.textContent).not.toContain('(codex login)');
});

it('offers to re-detect, for someone who has just signed in', async () => {
  const api = await open('codex');
  const redetect = [...notSignedIn()!.querySelectorAll('button')].find((b) => b.textContent === t('connect.nodeReDetect'))!;
  await act(async () => { redetect.click(); });
  expect((api.enqueueNodeCommand as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toContain('detect_runtimes');
});

it('lets an agent through once its device is signed in', async () => {
  const api = await open('codex', { ready: true });
  await submit();
  expect(created(api)).toHaveLength(1);
});

it('lets an agent that installs on add through, since it cannot be signed in yet', async () => {
  const api = await open('codex', { installed: false });
  expect(notSignedIn()).toBeNull();
  await submit();
  expect(created(api)).toHaveLength(1);
});

it('does not warn when the device is already signed in', async () => {
  await open('codex', { ready: true });
  expect(notSignedIn()).toBeNull();
});

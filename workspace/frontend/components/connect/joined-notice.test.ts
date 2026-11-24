// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
const opened = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, vars?: object) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ setSelectedAgentName: vi.fn() }) }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ refreshAgents: vi.fn(async () => {}) }) }));
vi.mock('@/components/agents/import-sessions-host', () => ({ openImportSessions: opened }));

import { useJoinedNotice } from './use-connect-requests';

const tools: Record<string, string> = { 'my-codex': 'Codex' };
let announce: (name: string) => void = () => {};
function Harness({ skip }: { skip: boolean }) {
  announce = useJoinedNotice(skip, (name) => tools[name] || null);
  return null;
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  toast.mockReset(); toast.success.mockReset(); opened.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (skip: boolean) => act(() => root.render(React.createElement(Harness, { skip })));

it('offers importing past sessions when an agent of an importable tool joins', () => {
  render(false);
  announce('my-codex');
  const [, opts] = toast.success.mock.calls[0];
  expect(opts.description).toBe('importSessions.joinedHint');
  opts.action.onClick();
  expect(opened).toHaveBeenCalledWith('my-codex');
});

it('makes no offer for other tools', () => {
  render(false);
  announce('my-aider');
  const [, opts] = toast.success.mock.calls[0];
  expect(opts.action.label).toBe('connect.viewAgent');
  expect(opts.description).toBeUndefined();
});

it('still offers it during onboarding, which skips the joined notice', () => {
  render(true);
  announce('my-aider');
  expect(toast).not.toHaveBeenCalled();
  announce('my-codex');
  expect(toast.success).not.toHaveBeenCalled();
  const [message, opts] = toast.mock.calls[0];
  expect(message).toContain('importSessions.onboardingOffer');
  expect(message).toContain('Codex');
  opts.action.onClick();
  expect(opened).toHaveBeenCalledWith('my-codex');
});

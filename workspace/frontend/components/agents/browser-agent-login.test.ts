// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserAgentLogin, safeLoginUrl } from './browser-agent-login';
import type { AgentSetupApi } from './agent-setup-types';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';

const seal = vi.hoisted(() => vi.fn());
vi.mock('./encrypt-agent-credentials', () => ({ encryptAgentCredentials: seal }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, params?: Record<string, string | number>) => translate(messages, messages, 'en-US', key, params) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  seal.mockReset().mockResolvedValue({ sessionId: 'session', encryptedCredentials: { ciphertext: 'sealed' } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

async function setup(type = 'codex') {
  let action = '';
  let status = 'waiting';
  const onSignedIn = vi.fn();
  const api = {
    enqueueNodeCommand: vi.fn(async (_node, next) => { action = next; return { commandId: next }; }),
    listNodeCommands: vi.fn(async () => [{ commandId: action, status: 'done', result: { ok: true, data: {
      sessionId: 'session', type, status, expiresAt: Date.now() + 60_000,
      url: type === 'codex' ? 'https://auth.openai.com/codex/device' : 'https://claude.ai/oauth/authorize?state=one', code: 'ABCD-EFGH',
    } } }]),
  } as unknown as AgentSetupApi;
  await act(async () => root.render(React.createElement(BrowserAgentLogin, { api, nodeId: 'n1', type, agent: type, onSignedIn })));
  const start = host.querySelector('button')!;
  await act(async () => start.click());
  return { api, onSignedIn, setStatus: (next: string) => { status = next; } };
}

it('shows the native device sign-in link and only finishes after verified success', async () => {
  const { api, onSignedIn, setStatus } = await setup();
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'login_start', { type: 'codex' });
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://auth.openai.com/codex/device');
  expect(host.textContent).toContain('ABCD-EFGH');
  expect(onSignedIn).not.toHaveBeenCalled();
  setStatus('done');
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(onSignedIn).toHaveBeenCalledOnce();
});

it('encrypts the pasted Claude code for the device and cancels on leaving', async () => {
  const { api } = await setup('claude');
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'secret-authorization#state');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const connect = [...host.querySelectorAll('button')].find(b => b.textContent === messages.agentSetup.browserLoginConnect)!;
  await act(async () => connect.click());
  expect(seal).toHaveBeenCalledWith(api, 'n1', 'login_input', { sessionId: 'session', config: { code: 'secret-authorization#state' } }, messages.agentSetup.secureUnavailable);
  expect(JSON.stringify(vi.mocked(api.enqueueNodeCommand).mock.calls)).not.toContain('secret-authorization');
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'login_input', expect.objectContaining({ encryptedCredentials: { ciphertext: 'sealed' } }));
  await act(async () => root.render(null));
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'login_cancel', { sessionId: 'session' });
});

it('rejects sign-in links to other sites and insecure URLs', () => {
  expect(safeLoginUrl('claude', 'https://claude.ai.evil.example/oauth/authorize')).toBeUndefined();
  expect(safeLoginUrl('claude', 'http://claude.ai/oauth/authorize')).toBeUndefined();
  expect(safeLoginUrl('codex', 'https://auth.openai.com/other')).toBeUndefined();
});

it('does not resume an old failed status poll while retry is starting', async () => {
  const { api } = await setup();
  vi.mocked(api.listNodeCommands).mockResolvedValueOnce([{ commandId: 'login_status', status: 'error' }] as never);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(host.querySelector('[role="alert"]')).toBeTruthy();

  let finishStart!: (value: { commandId: string }) => void;
  vi.mocked(api.enqueueNodeCommand).mockImplementationOnce(() => new Promise(resolve => { finishStart = resolve; }));
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === messages.agentSetup.retry)!;
  await act(async () => retry.click());
  const statusCalls = vi.mocked(api.enqueueNodeCommand).mock.calls.filter(call => call[1] === 'login_status').length;
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(vi.mocked(api.enqueueNodeCommand).mock.calls.filter(call => call[1] === 'login_status')).toHaveLength(statusCalls);
  expect(host.querySelector('a')).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();

  vi.mocked(api.listNodeCommands).mockResolvedValue([{ commandId: 'retry-start', status: 'done', result: { ok: true, data: {
    sessionId: 'new-session', type: 'codex', status: 'waiting', expiresAt: Date.now() + 60000,
    url: 'https://auth.openai.com/codex/device', code: 'NEWW-CODE',
  } } }] as never);
  await act(async () => finishStart({ commandId: 'retry-start' }));
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://auth.openai.com/codex/device');
  expect(host.textContent).toContain('NEWW-CODE');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('keeps the same sign-in command after a transient status request failure', async () => {
  const { api, onSignedIn, setStatus } = await setup();
  vi.mocked(api.listNodeCommands).mockRejectedValueOnce(new Error('Network interrupted'));
  setStatus('done');
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(onSignedIn).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(vi.mocked(api.enqueueNodeCommand).mock.calls.filter(call => call[1] === 'login_status')).toHaveLength(1);
});

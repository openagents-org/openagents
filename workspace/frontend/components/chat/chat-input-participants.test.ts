// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatInput } from './chat-input';
import { workspaceApi } from '@/lib/api';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';

vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  workspace: { workspaceId: 'workspace' }, currentUser: { id: 'me@example.com' }, pendingApprovalsByAgent: {},
}) }));
vi.mock('@/hooks/use-team-roster', () => ({ useTeamRoster: () => [
  { email: 'me@example.com', displayName: 'Me' },
  { email: 'sam@example.com', displayName: 'Sam' },
  { email: 'maya@example.com', displayName: 'Maya' },
] }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ workspaceApi: { getChannelParticipants: vi.fn() } }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
const send = vi.fn();
const participants = (emails: string[]): Awaited<ReturnType<typeof workspaceApi.getChannelParticipants>> => ({
  channel: 'thread', visibility: 'private', director_email: null,
  humans: emails.map(email => ({ email, display_name: null, joined_at: null })), agents: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workspaceApi.getChannelParticipants).mockResolvedValue(participants(['me@example.com', 'sam@example.com']));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function render(conversationId = 'thread') {
  await act(async () => root.render(React.createElement(ChatInput, { conversationId, onSend: send })));
}
async function type(text: string) {
  const input = document.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const buttons = () => [...document.querySelectorAll('button')].map(b => b.textContent).join('|');
it('suggests only joined humans and refreshes after membership changes', async () => {
  await render(); await type('@');
  expect(buttons()).toContain('Sam');
  expect(buttons()).not.toContain('Maya');
  expect(buttons()).not.toContain('me@example.com');
  vi.mocked(workspaceApi.getChannelParticipants).mockResolvedValue(participants(['maya@example.com']));
  await act(async () => { window.dispatchEvent(new CustomEvent(THREAD_PARTICIPANTS_CHANGED, { detail: 'thread' })); });
  expect(buttons()).toContain('Maya');
  expect(buttons()).not.toContain('Sam');
});
it('does not expose the old thread roster while the new one loads or fails', async () => {
  await render(); await type('@');
  let reject!: (reason: Error) => void;
  vi.mocked(workspaceApi.getChannelParticipants).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  await render('other');
  expect(buttons()).not.toContain('Sam');
  expect(buttons()).not.toContain('Maya');
  await act(async () => reject(new Error('Forbidden')));
  expect(buttons()).not.toContain('Sam');
});
it('only suggests the other human in a DM without fetching channel membership', async () => {
  await render('dm:human:me@example.com,human:maya@example.com'); await type('@');
  expect(buttons()).toContain('Maya');
  expect(buttons()).not.toContain('Sam');
  expect(workspaceApi.getChannelParticipants).not.toHaveBeenCalled();
});
it('does not send mention notifications to nonparticipants typed manually', async () => {
  await render(); await type('@maya@example.com hello');
  await act(async () => document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(send).toHaveBeenCalledWith('@maya@example.com hello', [], [], []);
});
it('offers @all in threads and sends it without agent mentions', async () => {
  await render(); await type('@All');
  const all = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('@all'))!;
  expect(all).toBeDefined();
  await act(async () => all.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(document.querySelector('textarea')!.value).toBe('@all ');
  await type('@all hello');
  await act(async () => document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(send).toHaveBeenCalledWith('@all hello', [], [], []);
});
it('displays a clicked sender mention by name, preserves the draft, and sends its stable identity', async () => {
  await act(async()=>root.render(React.createElement(ChatInput,{conversationId:'thread',onSend:send,draft:'Existing text @sam@example.com ',focusKey:1})));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));
  const input=document.querySelector('textarea')!;
  expect(input.value).toBe('Existing text @Sam ');
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(input.value.length);
  await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(send).toHaveBeenCalledWith('Existing text @sam@example.com',[],[],['sam@example.com']);
});

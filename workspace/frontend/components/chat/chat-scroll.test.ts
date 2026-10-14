// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('./agent-message-access', () => ({ AgentMessageAccessProvider: ({ children }: any) => children }));
vi.mock('./message-reactions', () => ({ MessageReactionsProvider: ({ children }: any) => children }));
vi.mock('./chat-message', () => ({ ChatMessage: () => null }));
vi.mock('./intermediate-steps', () => ({ IntermediateSteps: () => null }));
vi.mock('./thinking-message', () => ({ ThinkingMessage: () => null }));
vi.mock('./working-bubble', () => ({ WorkingBubble: () => null }));
const scrollToIndex = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({ scrollToIndex, getTotalSize: () => 1000, getVirtualItems: () => [] }) }));
import { ChatMessages } from './chat-messages';
let host: HTMLDivElement, root: Root;
let frames: Map<number, FrameRequestCallback>, sequence: number;
let observers: Set<() => void>;
let height: number;
const message = (sessionId = 'first') => ({ messageId: sessionId, sessionId, messageType: 'chat', content: 'hello' }) as any;
const render = async (session = 'first') => act(async () => root.render(React.createElement(ChatMessages, { messages: [message(session)], showAllSteps: false })));
const viewport = () => host.querySelector('[tabindex="0"]') as HTMLDivElement;
async function flush() {
  await act(async () => {
    for (let i = 0; frames.size && i < 70; i++) {
      const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(i));
    }
  });
}
async function resize() { await act(async () => observers.forEach(callback => callback())); await flush(); }
const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, '', '/');
  scrollToIndex.mockClear();
  height = 1000; frames = new Map(); sequence = 0; observers = new Set();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; observers.add(callback); }
    observe() {} disconnect() { observers.delete(this.callback); }
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const tops = new WeakMap<HTMLElement, number>();
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get() { return tops.get(this) ?? 0; }, set(value: number) { tops.set(this, Math.max(0, Math.min(value, height - 400))); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTop);
  else delete (HTMLElement.prototype as any).scrollTop;
});
it('opens at the bottom and follows images loading after the settle loop finished', async () => {
  await render(); await flush(); expect(viewport().scrollTop).toBe(600);
  height = 2400;
  await act(async () => viewport().dispatchEvent(new Event('scroll')));
  await resize(); expect(viewport().scrollTop).toBe(2000);
  expect(host.textContent).not.toContain('chat.newMessages');
});
it('does not pull readers down after a deliberate scroll, but resumes at the bottom', async () => {
  await render(); await flush();
  await act(async () => { viewport().dispatchEvent(new WheelEvent('wheel', { deltaY: -200 })); viewport().scrollTop = 200; viewport().dispatchEvent(new Event('scroll')); });
  height = 2400; await resize(); expect(viewport().scrollTop).toBe(200);
  await act(async () => { viewport().scrollTop = 2000; viewport().dispatchEvent(new Event('scroll')); });
  height = 2600; await resize(); expect(viewport().scrollTop).toBe(2200);
});
it('resets user scroll intent when switching threads and cleans up pending work', async () => {
  await render(); await flush();
  await act(async () => { viewport().dispatchEvent(new WheelEvent('wheel', { deltaY: -200 })); viewport().scrollTop = 200; viewport().dispatchEvent(new Event('scroll')); });
  await render('second'); await flush(); expect(viewport().scrollTop).toBe(600);
  await act(async () => observers.forEach(callback => callback()));
  await act(async () => root.render(null));
  expect(frames.size).toBe(0); expect(observers.size).toBe(0);
});


it.each(['/?message=older', '/acme/threads/thread-id/messages/older'])('loads earlier history for a message link %s and scrolls to its row instead of the bottom', async (url) => {
  window.history.replaceState(null, '', url);
  const loadOlder = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(React.createElement(ChatMessages, { messages: [message()], showAllSteps: false, hasOlder: true, loadOlder })));
  await flush();
  expect(loadOlder).toHaveBeenCalledTimes(1);
  expect(viewport().scrollTop).toBe(0);
  await act(async () => root.render(React.createElement(ChatMessages, { messages: [{...message(),messageId:'older'},message()], showAllSteps: false, hasOlder: false, loadOlder })));
  await flush();
  expect(scrollToIndex).toHaveBeenCalledWith(0,{align:'center'});
  expect(viewport().scrollTop).toBe(0);
});

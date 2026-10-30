// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { GranteePicker } from './grantee-picker';
vi.mock('@/lib/api', () => ({ workspaceApi: { getTeam: async () => Array.from({ length: 20 }, (_, i) => ({ email: `person${i}@test.example`, displayName: `Person ${i}` })), discover: async () => ({ agents: [] }), listGroups: async () => [] } }));

vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => translate(messages, messages, 'en-US', key) }));
vi.mock('@/components/chat/human-avatar', () => ({ HumanAvatar: () => null }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('allows wheel and touch scrolling in the portaled picker while keeping the dialog background locked', async () => {
  const onChange = vi.fn();
  await act(async () => root.render(createElement(Dialog, { open: true },
    createElement(DialogContent, { 'aria-describedby': undefined },
      createElement(DialogTitle, {}, 'Share agent'),
      createElement(GranteePicker, { value: [], onChange, kinds: ['human'], placeholder: 'Add people' }),
    ),
  )));
  await act(async () => (Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Add people')) as HTMLButtonElement).click());
  const list = document.querySelector('[cmdk-list]') as HTMLElement;
  expect(list).not.toBeNull();
  // jsdom has no layout: provide overflowing list geometry to the real Radix
  // scroll-lock code. Keep both the real Dialog and portaled Popover mounted.
  Object.defineProperties(list, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  list.style.overflowY = 'auto';
  const wheel = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true });
  await act(async () => { list.dispatchEvent(wheel); });
  expect(wheel.defaultPrevented).toBe(false);
  const touch = (type: string, y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { touches: [{ clientX: 0, clientY: y }], changedTouches: [{ clientX: 0, clientY: y }] });
    return event;
  };
  await act(async () => { list.dispatchEvent(touch('touchstart', 100)); });
  const move = touch('touchmove', 20);
  await act(async () => { list.dispatchEvent(move); });
  expect(move.defaultPrevented).toBe(false);
  const outsideWheel = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true });
  await act(async () => { document.body.dispatchEvent(outsideWheel); });
  expect(outsideWheel.defaultPrevented).toBe(true);
  await act(async () => (document.querySelector('[cmdk-item][data-value="human:person19@test.example"]') as HTMLElement).click());
  expect(onChange).toHaveBeenCalledWith([{ kind: 'human', id: 'person19@test.example', label: 'Person 19' }]);
  expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
  expect(document.querySelector('[cmdk-list]')).not.toBeNull();
});

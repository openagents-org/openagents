// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import { IssueDueDate } from './issue-due-date';
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'en-US' }), useT: () => (key: string) => translate(messages, messages, 'en-US', key) }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('shows everyone the exact calendar date, with no editing controls for nonowners', async () => {
  await act(async () => root.render(createElement(IssueDueDate, { issue: { id: 'one', due_date: '2026-10-25' }, busy: false, canEdit: false, update: vi.fn() })));
  expect(host.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-25');
  expect(host.textContent).toContain('2026-10-25');
  expect(host.querySelector('button')).toBeNull();
});

it('lets the creator select a date and explicitly clear it', async () => {
  const update = vi.fn();
  const render = async (due_date: string | null) => { await act(async () => root.render(createElement(IssueDueDate, { issue: { id: 'one', due_date }, busy: false, canEdit: true, update }))); };
  await render('2028-02-10');
  await act(async () => host.querySelector('button')!.click());
  expect(document.querySelector('input[type="date"]')).toBeNull();
  expect(document.querySelector('[role="grid"]')).not.toBeNull();
  const day = document.querySelector('[data-day="2028-02-29"] button') as HTMLButtonElement;
  expect(day).not.toBeNull();
  await act(async () => day.click());
  expect(update).toHaveBeenLastCalledWith({ due_date: '2028-02-29' });
  await render('2028-02-29');
  await act(async () => host.querySelector('button')!.click());
  const clear = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Remove due date')!;
  await act(async () => clear.click());
  expect(update).toHaveBeenLastCalledWith({ due_date: null });
});

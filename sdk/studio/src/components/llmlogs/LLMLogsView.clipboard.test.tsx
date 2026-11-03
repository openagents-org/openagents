import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { toast } from 'sonner';
import LLMLogsView from './LLMLogsView';
jest.mock('sonner', () => ({ toast: { error: require('@jest/globals').jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-syntax-highlighter', () => ({ Prism: ({ children }: any) => <pre>{children}</pre> }));
jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({ oneDark: {}, oneLight: {} }));
jest.mock('@/stores/themeStore', () => ({ useThemeStore: () => ({ theme: 'light' }) }), { virtual: true });
jest.mock('@/stores/llmLogStore', () => ({ useLLMLogStore: () => ({
  logs: [{ id: 'synthetic-log', model: 'model', prompt: 'synthetic prompt', completion: 'synthetic completion', timestamp: 0, latency_ms: 1 }],
  filters: {}, searchQuery: '', stats: null, copyToClipboard: require('../../utils/clipboard').copyTextToClipboard,
}) }), { virtual: true });
jest.mock('@/components/layout/ui/data-table', () => ({ DataTable: ({ data, onRowClick }: any) => <button onClick={() => onRowClick(data[0])}>Open log</button> }), { virtual: true });
jest.mock('@/components/layout/ui/button', () => ({Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>}), { virtual: true });
jest.mock('@/components/layout/ui/input', () => ({Input: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>}), { virtual: true });
jest.mock('@/components/layout/ui/card', () => ({Card: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,CardContent: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,CardDescription: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,CardHeader: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,CardHeading: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,CardTitle: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,CardToolbar: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>}), { virtual: true });
jest.mock('@/components/layout/ui/badge', () => ({Badge: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>}), { virtual: true });
jest.mock('@/components/layout/ui/select', () => ({Select: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,SelectContent: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,SelectItem: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,SelectTrigger: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,SelectValue: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>}), { virtual: true });
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  jest.useFakeTimers(); jest.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn(async (_text: string) => {}) } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LLMLogsView />));
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Open log')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.useRealTimers(); });
function buttons() { const b = [...host.querySelectorAll('button')].filter(b => /actions.(copy|copied)/.test(b.textContent || '')); expect(b).toHaveLength(2); return b; }
it('does not mark the old prompt after a newer completion copy fails', async () => {
  let finish!: () => void;
  (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => buttons()[0].click());
  (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mockRejectedValueOnce(new Error('denied'));
  await act(async () => buttons()[1].click());
  expect(toast.error).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(buttons().every(b => b.textContent === 'actions.copy')).toBe(true);
});
it('does not let the prompt timer clear newer completion feedback', async () => {
  await act(async () => buttons()[0].click());
  await act(async () => { jest.advanceTimersByTime(1000); });
  await act(async () => buttons()[1].click());
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(buttons()[1].textContent).toBe('actions.copied');
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(buttons()[1].textContent).toBe('actions.copy');
});

it('ignores a late failure after a newer success', async () => {
  let reject!: (error: Error) => void;
  (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  await act(async () => buttons()[0].click());
  await act(async () => buttons()[0].click());
  await act(async () => reject(new Error('denied')));
  expect(toast.error).not.toHaveBeenCalled();
});
it('does not show an error from a copy completing after unmount', async () => {
  let reject!: (error: Error) => void;
  (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  await act(async () => buttons()[0].click());
  await act(async () => root.unmount());
  await act(async () => reject(new Error('denied')));
  expect(toast.error).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import ApiCreditsSettingsPage from './page';
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: 'synthetic' }) }));
vi.mock('@/lib/account-api', () => ({
  getCampaignStatus: async () => ({ enabled: true, gatewayUrl: 'https://example.invalid', apiKey: 'synthetic', milestones: [] }),
  getCampaignModels: async () => ({ models: ['model-a', 'model-b'] }),
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(ApiCreditsSettingsPage)));
  const expand = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('campaign.showAllModels'))!;
  await act(async () => expand.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function button(id: string) { const b = host.querySelector<HTMLButtonElement>(`button[title="${id}"]`); expect(b).not.toBeNull(); return b!; }
it('does not mark the old model when its native write finishes after a newer failure', async () => {
  let finish!: () => void;
  vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => button('model-a').click());
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
  await act(async () => button('model-b').click());
  expect(toast.error).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(button('model-a').querySelector('.lucide-check')).toBeNull();
  expect(button('model-b').querySelector('.lucide-check')).toBeNull();
});
it('owns one timeout for the latest copied model', async () => {
  await act(async () => button('model-a').click());
  await act(async () => vi.advanceTimersByTime(1000));
  await act(async () => button('model-b').click());
  await act(async () => vi.advanceTimersByTime(500));
  expect(button('model-b').querySelector('.lucide-check')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(button('model-b').querySelector('.lucide-check')).toBeNull();
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OnboardingPairingPanel } from './onboarding-pairing-panel';
import { I18nProvider } from '@/lib/i18n';

let root: Root;
let container: HTMLDivElement;
const copy = vi.fn().mockResolvedValue(undefined);
const pairing = { code: 'TEST-CODE', expiresAt: '2026-11-02T15:30:00Z', expiresInSeconds: 1800 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  copy.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function render(value = pairing) {
  await act(async () => root.render(React.createElement(I18nProvider, { initialLocale: 'en-US', hasStoredLocale: true, children: React.createElement(OnboardingPairingPanel, { pairing: value }) })));
}
function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text))!;
}
it('keeps desktop setup focused, and copies the pairing code', async () => {
  await render();
  await act(async () => button('Desktop app').click());
  expect(container.querySelectorAll('a')).toHaveLength(3);
  expect(container.querySelector('code')).toBeNull();
  await act(async () => button('TEST-CODE').click());
  expect(copy).toHaveBeenCalledWith('TEST-CODE');
  expect(button('TEST-CODE').textContent).toContain('Copied');
});
it('starts with command-line setup and switches the install command for Windows', async () => {
  await render();
  expect(button('Command line').getAttribute('aria-pressed')).toBe('true');
  expect(container.textContent).not.toContain('Recommended');
  expect(container.querySelector('details')?.open).toBe(false);
  expect(button('TEST-CODE').disabled).toBe(false);
  await act(async () => button('TEST-CODE').click());
  expect(copy).toHaveBeenCalledWith('TEST-CODE');
  expect(container.querySelectorAll('a')).toHaveLength(0);
  expect([...container.querySelectorAll('code')].map(c => c.textContent)).toEqual([
    'curl -fsSL https://openagents.org/install.sh | bash', 'agn device connect TEST-CODE',
  ]);
  await act(async () => button('Windows').click());
  expect(container.querySelector('code')?.textContent).toBe('irm https://openagents.org/install.ps1 | iex');
  await act(async () => button('Desktop app').click());
  expect(container.querySelectorAll('a')).toHaveLength(3);
});
it('stops offering an expired pairing code on both setup paths', async () => {
  await render();
  await act(async () => button('Desktop app').click());
  await act(async () => vi.advanceTimersByTimeAsync(1800000));
  expect(button('TEST-CODE').disabled).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Code expired');
  await act(async () => button('Command line').click());
  expect(button('TEST-CODE').disabled).toBe(true);
  const copies = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Copy command"]');
  expect(copies[0].disabled).toBe(false);
  expect(copies[1].disabled).toBe(true);
});

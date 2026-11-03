// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { OnboardingConnectionHero } from './onboarding-connection-hero';

let root: Root;
let host: HTMLDivElement;
let setup: HTMLDivElement;
const scroll = vi.fn();
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  host = document.createElement('div'); setup = document.createElement('div');
  setup.id = 'onboarding-device-setup'; setup.scrollIntoView = scroll;
  document.body.append(host, setup); root = createRoot(host);
  await act(async () => root.render(React.createElement(I18nProvider, { initialLocale: 'en-US', hasStoredLocale: true, children: React.createElement(OnboardingConnectionHero, { workspaceName: 'My team' }) })));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); setup.remove(); scroll.mockClear(); vi.unstubAllGlobals();
});
it('takes the user from the opening visual to device setup', async () => {
  const cta = host.querySelector<HTMLButtonElement>('button')!;
  expect(cta.textContent).toContain('Connect your first agent');
  await act(async () => cta.click());
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
});
it('skips scroll animation when reduced motion is requested', async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(scroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
});

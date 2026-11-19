// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FirstRunOnboarding } from './first-run-onboarding';

const fixture = vi.hoisted(() => ({ idToken: null as string | null, profile: vi.fn(), updateProfile: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => function Welcome({ embedded, onContinue }: { embedded: boolean; onContinue: () => void }) {
  return React.createElement('section', { 'data-embedded': embedded, 'aria-label': 'Welcome page' },
    React.createElement('button', { onClick: onContinue }, 'Skip tutorial'),
    React.createElement('button', { onClick: onContinue }, 'Get started'));
} }));
vi.mock('./connect-agent-view', () => ({ ConnectAgentView: () => React.createElement('section', null, 'Connect Agent page') }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: fixture.idToken }) }));
vi.mock('@/lib/account-api', () => ({ getAccountProfile: fixture.profile, updateAccountProfile: fixture.updateProfile }));
vi.mock('@/lib/desktop-host', () => ({ desktopHost: () => null }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));

const Onboarding: React.ComponentType<NonNullable<Parameters<typeof FirstRunOnboarding>[0]>> = FirstRunOnboarding;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.idToken = null;
  fixture.profile.mockResolvedValue({ welcomeSeen: false });
  fixture.updateProfile.mockResolvedValue({});
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each(['Skip tutorial', 'Get started'])('%s dismisses Welcome and opens Connect Agent, including after remount', async action => {
  fixture.idToken = 'test-identity';
  const onWelcomeChange = vi.fn();
  await act(async () => root.render(React.createElement(Onboarding, { onWelcomeChange })));
  expect(host.querySelector('[data-embedded="true"]')).not.toBeNull();
  expect(onWelcomeChange).toHaveBeenLastCalledWith(true);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === action)!.click());
  expect(host.textContent).toBe('Connect Agent page');
  expect(onWelcomeChange).toHaveBeenLastCalledWith(false);
  expect(localStorage.getItem('oa:welcomeFilmSeen')).toBe('1');
  expect(fixture.updateProfile).toHaveBeenCalledWith('test-identity', { welcomeSeen: true });
  await act(async () => root.render(null));
  await act(async () => root.render(React.createElement(Onboarding, { onWelcomeChange })));
  expect(host.textContent).toBe('Connect Agent page');
  expect(onWelcomeChange).toHaveBeenLastCalledWith(false);
});

it('honors completion on another device', async () => {
  fixture.idToken = 'test-identity';
  fixture.profile.mockResolvedValue({ welcomeSeen: true });
  const onWelcomeChange = vi.fn();
  await act(async () => root.render(React.createElement(Onboarding, { onWelcomeChange })));
  expect(host.textContent).toBe('Connect Agent page');
  expect(onWelcomeChange).toHaveBeenLastCalledWith(false);
});

it('reopens Welcome explicitly after completion and returns to Connect Agent again', async () => {
  fixture.idToken = 'test-identity';
  localStorage.setItem('oa:welcomeFilmSeen', '1');
  fixture.profile.mockResolvedValue({ welcomeSeen: true });
  const onWelcomeComplete = vi.fn();
  await act(async () => root.render(React.createElement(Onboarding, { forceWelcome: true, onWelcomeComplete })));
  expect(host.querySelector('[aria-label="Welcome page"]')).not.toBeNull();
  expect(fixture.profile).not.toHaveBeenCalled();
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).toBe('Connect Agent page');
  expect(onWelcomeComplete).toHaveBeenCalledOnce();
});

it('can preview inside an existing workspace without changing account completion', async () => {
  fixture.idToken = 'test-identity';
  localStorage.setItem('oa:welcomeFilmSeen', '1');
  await act(async () => root.render(React.createElement(Onboarding, { previewWelcome: true })));
  expect(host.querySelector('[aria-label="Welcome page"]')).not.toBeNull();
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).toBe('Connect Agent page');
  expect(fixture.profile).not.toHaveBeenCalled();
  expect(fixture.updateProfile).not.toHaveBeenCalled();
});

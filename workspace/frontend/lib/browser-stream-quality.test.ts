// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ForcedStreamQuality, useStreamQuality } from './browser-stream-quality';
import { embedUrl } from '@/components/browser/browser-viewport';

vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));

it('asks Browser Fabric for the chosen preset', () => {
  expect(embedUrl('https://www.browserfabric.com/live/tok', 'high')).toBe('https://www.browserfabric.com/live/tok?embed=1&q=high');
  expect(embedUrl('https://x/live/tok?a=1', 'low')).toBe('https://x/live/tok?a=1&embed=1&q=low');
});

it('defaults to high, remembers a choice, and lets small previews force low', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  let seen: ReturnType<typeof useStreamQuality> | null = null;
  const Probe = () => { seen = useStreamQuality(); return null; };
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Probe)));
  expect(seen!.quality).toBe('high');
  await act(async () => seen!.setQuality('low'));
  expect(seen!.quality).toBe('low');
  expect(store.get('oa.browser.streamQuality')).toBe('low');
  await act(async () => seen!.setQuality('high'));
  await act(async () => root.render(React.createElement(ForcedStreamQuality.Provider, { value: 'low' }, React.createElement(Probe))));
  expect(seen!.quality).toBe('low');
  expect(seen!.forced).toBe(true);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTokenPayModels } from './use-tokenpay-models';

const api = vi.hoisted(() => ({ modelProbe: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: api }));

let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useTokenPayModels>;
function Harness({ enabled, apiKey }: { enabled: boolean; apiKey: string }) {
  result = useTokenPayModels(enabled, apiKey);
  return null;
}
async function render(key: string, enabled = true) {
  await act(async () => { root.render(React.createElement(Harness, { enabled, apiKey: key })); });
}
async function load() {
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.modelProbe.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('waits for key entry, then lists live models with provider labels', async () => {
  const models = [{ id: 'glm-5', label: 'Z.ai: GLM 5', category: 'chat' }];
  api.modelProbe.mockResolvedValue({ keyOk: true, models });
  await render('   ');
  await load();
  expect(api.modelProbe).not.toHaveBeenCalled();
  await render(' key-one ');
  expect(result.loading).toBe(true);
  await load();
  expect(api.modelProbe).toHaveBeenCalledWith({ provider: 'tokenpay', apiKey: 'key-one' });
  expect(result.models).toEqual(models);
  expect(result.loading).toBe(false);
});

it('discards a response for a key the user replaced', async () => {
  let finish!: (response: unknown) => void;
  api.modelProbe.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await render('old-key');
  await load();
  await render('new-key');
  await act(async () => { finish({ keyOk: true, models: [{ id: 'old-model' }] }); });
  expect(result.models).toEqual([]);
  api.modelProbe.mockResolvedValue({ keyOk: true, models: [{ id: 'new-model' }] });
  await load();
  expect(result.models.map((m) => m.id)).toEqual(['new-model']);
});

it('clears models when a replacement key is rejected', async () => {
  api.modelProbe.mockResolvedValueOnce({ keyOk: true, models: [{ id: 'model' }] });
  await render('valid');
  await load();
  await render('invalid');
  expect(result.models).toEqual([]);
  api.modelProbe.mockResolvedValueOnce({ keyOk: false, error: 'Invalid API key' });
  await load();
  expect(result.models).toEqual([]);
  expect(result.error).toBe('Invalid API key');
  expect(result.loading).toBe(false);
});

it('does not request TokenPay models for another provider', async () => {
  await render('other-provider-key', false);
  await load();
  expect(api.modelProbe).not.toHaveBeenCalled();
  expect(result.models).toEqual([]);
});

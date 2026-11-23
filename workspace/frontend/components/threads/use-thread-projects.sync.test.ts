// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: { getPersonalSetting: api.get, putPersonalSetting: api.put } }));
import { mergeThreadProjects, useThreadProjects } from './use-thread-projects';

let host: HTMLDivElement, root: Root;
let model: ReturnType<typeof useThreadProjects>;
let storage: Map<string, string>;
const KEY = `oa-thread-projects:${JSON.stringify(['ws', 'alice'])}`;
function Harness() { model = useThreadProjects('ws', 'alice', [], []); return null; }
const render = async () => { await act(async () => root.render(React.createElement(Harness))); };
const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const saved = async () => { await act(async () => { await new Promise(r => setTimeout(r, 600)); }); };
const FD = { id: 'fd', name: 'FD', color: 0 };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  api.get.mockReset(); api.put.mockReset(); api.put.mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('a new device (the desktop app) shows the projects saved on the server', async () => {
  api.get.mockResolvedValue({ value: { projects: [FD], assignments: { t1: 'fd' } }, persisted: true });
  await render(); await settle();
  expect(model.projects).toEqual([FD]);
  expect(model.assignments).toEqual({ t1: 'fd' });
  await saved();
  expect(api.put).not.toHaveBeenCalled(); // nothing new to save
});

it('a browser that already had projects uploads them on its first sync', async () => {
  storage.set(KEY, JSON.stringify({ version: 1, projects: [FD], assignments: { t1: 'fd' }, collapsed: [], selected: 'all', grouped: true }));
  api.get.mockResolvedValue({ value: null, persisted: true });
  await render(); await settle(); await saved();
  expect(api.put).toHaveBeenCalledWith('thread_projects', { projects: [FD], assignments: { t1: 'fd' } });
});

it('merges once with what the server has, then saves every change', async () => {
  storage.set(KEY, JSON.stringify({ version: 1, projects: [FD], assignments: { t1: 'fd' }, collapsed: [], selected: 'all', grouped: true }));
  const other = { id: 'ops', name: 'Ops', color: 1 };
  api.get.mockResolvedValue({ value: { projects: [other], assignments: { t2: 'ops' } }, persisted: true });
  await render(); await settle();
  expect(model.projects.map(p => p.id)).toEqual(['ops', 'fd']);
  expect(model.assignments).toEqual({ t1: 'fd', t2: 'ops' });
  await saved();
  expect(api.put).toHaveBeenLastCalledWith('thread_projects', { projects: [other, FD], assignments: { t1: 'fd', t2: 'ops' } });
  await act(async () => { model.move('t3', 'fd'); }); await saved();
  expect(api.put).toHaveBeenLastCalledWith('thread_projects', expect.objectContaining({ assignments: { t1: 'fd', t2: 'ops', t3: 'fd' } }));
  // Layout and filter stay on this device.
  api.put.mockClear(); await act(async () => { model.setGrouped(false); model.select('fd'); }); await saved();
  expect(api.put).not.toHaveBeenCalled();
});

it('keeps working locally when there is no signed-in person or no server', async () => {
  api.get.mockResolvedValue({ value: null, persisted: false });
  await render(); await settle();
  await act(async () => { model.create('Local only'); }); await saved();
  expect(api.put).not.toHaveBeenCalled();
  expect(model.projects[0].name).toBe('Local only');
});

it('merge keeps both sides and drops assignments to missing projects', () => {
  expect(mergeThreadProjects({ projects: [FD], assignments: { a: 'fd', b: 'gone' } }, { projects: [], assignments: {} }))
    .toEqual({ projects: [FD], assignments: { a: 'fd' } });
});

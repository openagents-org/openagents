// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readThreadProjects, THREAD_PROJECT_CREATED, useThreadProjects } from './use-thread-projects';

let host: HTMLDivElement, root: Root;
let scope: [string, string];
let model: ReturnType<typeof useThreadProjects>;
let storage: Map<string, string>;
function Harness() { model = useThreadProjects(...scope, [], []); return null; }
const render = async () => { await act(async () => root.render(React.createElement(Harness))); };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  scope = ['workspace', 'alice'];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('creates and assigns a thread in one interaction, restores choices after reload', async () => {
  await render(); let id = '';
  await act(async () => { id = model.create('Design'); model.move('thread-1', id); model.toggle(id); model.select(id); model.setGrouped(false); });
  expect(model.assignments['thread-1']).toBe(id);
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(model.projects[0].name).toBe('Design'); expect(model.collapsed).toContain(id); expect(model.selected).toBe(id); expect(model.grouped).toBe(false);
});
it('isolates projects and assignments by workspace and viewer', async () => {
  await render(); await act(async () => { const id = model.create('Private grouping'); model.move('thread', id); });
  scope = ['workspace', 'bob']; await render(); expect(model.projects).toEqual([]);
  scope = ['other-workspace', 'alice']; await render(); expect(model.assignments).toEqual({});
  scope = ['workspace', 'alice']; await render(); expect(model.projects[0].name).toBe('Private grouping');
});
it('removes only organization, returning assigned threads to Unorganized', async () => {
  await render(); let id = '';
  await act(async () => { id = model.create('Product'); model.move('thread', id); model.select(id); });
  await act(async () => model.remove(id));
  expect(model.projects).toEqual([]); expect(model.assignments).toEqual({}); expect(model.selected).toBe('all');
});
it('adds newly created threads to the selected project, ignoring other viewers', async () => {
  await render(); let id = '';
  await act(async () => { id = model.create('Engineering'); model.select(id); });
  await act(async () => window.dispatchEvent(new CustomEvent(THREAD_PROJECT_CREATED, { detail: { workspace: 'workspace', viewer: 'alice', thread: 'new-thread' } })));
  expect(model.assignments['new-thread']).toBe(id);
  await act(async () => window.dispatchEvent(new CustomEvent(THREAD_PROJECT_CREATED, { detail: { workspace: 'workspace', viewer: 'bob', thread: 'other-thread' } })));
  expect(model.assignments['other-thread']).toBeUndefined();
});
it('recovers safely from malformed preferences and filters missing project references', () => {
  expect(readThreadProjects('{broken').projects).toEqual([]);
  expect(readThreadProjects(JSON.stringify({ version: 1, projects: [], assignments: { thread: 'missing' }, selected: 'missing' })).assignments).toEqual({});
});
it('reorders before and after drop targets without changing assignments, and restores the order', async () => {
  await render(); let first = '', second = '', third = '';
  await act(async () => { first = model.create('Design'); second = model.create('Engineering'); third = model.create('Research'); model.move('thread', first); model.toggle(first); });
  await act(async () => model.reorder(third, first, 'before'));
  expect(model.projects.map(p => p.name)).toEqual(['Research', 'Design', 'Engineering']);
  await act(async () => model.reorder(third, second, 'after'));
  expect(model.projects.map(p => p.name)).toEqual(['Design', 'Engineering', 'Research']);
  expect(model.assignments.thread).toBe(first); expect(model.collapsed).toContain(first);
  await act(async () => model.moveOrder(third, -1));
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(model.projects.map(p => p.name)).toEqual(['Design', 'Research', 'Engineering']);
});
it('bounds menu-based moves and ignores invalid or self drop targets', async () => {
  await render(); let first = '', last = '';
  await act(async () => { first = model.create('First'); last = model.create('Last'); });
  await act(async () => { model.moveOrder(first, -1); model.moveOrder(last, 1); model.moveOrder('missing', -1); model.reorder(first, first, 'after'); model.reorder(first, 'missing', 'before'); });
  expect(model.projects.map(p => p.name)).toEqual(['First', 'Last']);
});

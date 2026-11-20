'use client';

import { useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceSession } from '@/lib/types';

export interface ThreadProject { id: string; name: string; color: number }
export interface ThreadProjectState {
  projects: ThreadProject[];
  assignments: Record<string, string>;
  collapsed: string[];
  selected: string;
  grouped: boolean;
}
export const THREAD_PROJECT_CREATED = 'oa-thread-project-created';
const empty = (): ThreadProjectState => ({ projects: [], assignments: {}, collapsed: [], selected: 'all', grouped: true });

export function readThreadProjects(raw: string | null): ThreadProjectState {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || value.version !== 1 || !Array.isArray(value.projects)) return empty();
    const projects: ThreadProject[] = value.projects.filter((p: ThreadProject) => p && typeof p.id === 'string' && typeof p.name === 'string' && Number.isInteger(p.color));
    const ids = new Set(projects.map(p => p.id));
    const assignments = Object.fromEntries(Object.entries(value.assignments || {}).filter(([, id]) => typeof id === 'string' && ids.has(id))) as Record<string, string>;
    return { projects, assignments, collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((id: unknown) => typeof id === 'string') : [], selected: value.selected === 'unorganized' || ids.has(value.selected) ? value.selected : 'all', grouped: value.grouped !== false };
  } catch { return empty(); }
}

/** The part every device shares (the server's "thread_projects" setting);
 *  which projects are collapsed, the filter and the layout stay per device. */
export type SharedThreadProjects = Pick<ThreadProjectState, 'projects' | 'assignments'>;
export const SETTING_KEY = 'thread_projects';
const shared = (s: ThreadProjectState): SharedThreadProjects => ({ projects: s.projects, assignments: s.assignments });

/** A device's first sync keeps what it already had: projects from both
 *  (the server's order first), and the server's choice where both assigned
 *  the same thread. */
export function mergeThreadProjects(local: SharedThreadProjects, server: SharedThreadProjects): SharedThreadProjects {
  const projects = [...server.projects, ...local.projects.filter(p => !server.projects.some(q => q.id === p.id))];
  const ids = new Set(projects.map(p => p.id));
  const assignments = Object.fromEntries(Object.entries({ ...local.assignments, ...server.assignments }).filter(([, id]) => ids.has(id)));
  return { projects, assignments };
}

/** Personal organization only: no thread metadata or permissions are changed.
 *  Kept on the server for the signed-in person, so the web app, the desktop
 *  app and the phone show the same projects; the browser's copy is a cache. */
export function useThreadProjects(workspace: string, viewer: string, sessions: WorkspaceSession[], exampleNames: string[]) {
  const key = workspace && viewer ? `oa-thread-projects:${JSON.stringify([workspace, viewer])}` : '';
  const [state, setState] = useState({ key: '', data: empty() });
  const loaded = useRef('');
  useEffect(() => {
    if (!key || loaded.current === key) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { /* Still usable in memory. */ }
    const examples = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_THREAD_PROJECTS_DEMO === '1';
    if (!raw && examples && sessions.length === 0) return;
    const data = readThreadProjects(raw);
    if (!raw && examples) {
      data.projects = exampleNames.map((name, color) => ({ id: `example-${color}`, name, color }));
      sessions.filter(s => s.status === 'active' && !s.sessionId.startsWith('dm:')).slice(0, 9).forEach((s, index) => {
        data.assignments[s.sessionId] = data.projects[index % data.projects.length].id;
      });
    }
    loaded.current = key;
    setState({ key, data });
  }, [key, sessions, exampleNames]);
  useEffect(() => {
    if (state.key && state.key === key) {
      try { localStorage.setItem(key, JSON.stringify({ ...state.data, version: 1 })); } catch { /* In-memory organization still works. */ }
    }
  }, [key, state]);

  // Server sync. `synced` holds the shared part as the server last had it:
  // a change that differs is saved; null until the first fetch answers.
  const synced = useRef<{ key: string; json: string } | null>(null);
  const [ready, setReady] = useState('');
  useEffect(() => {
    if (!key || state.key !== key) return;
    let cancelled = false;
    const pull = async (first: boolean) => {
      let remote: { value: SharedThreadProjects | null; persisted: boolean };
      try { remote = await workspaceApi.getPersonalSetting<SharedThreadProjects>(SETTING_KEY); } catch { return; }
      if (cancelled || !remote.persisted) return;
      const mergedOnce = `${key}:synced`;
      let firstOnDevice = false;
      try { firstOnDevice = first && !localStorage.getItem(mergedOnce); } catch { /* treat as already merged */ }
      setState(previous => {
        if (previous.key !== key) return previous;
        const local = shared(previous.data);
        const server = remote.value ? readThreadProjects(JSON.stringify({ version: 1, ...remote.value })) : null;
        const next = server
          ? (firstOnDevice && local.projects.length ? mergeThreadProjects(local, shared(server)) : shared(server))
          : local;
        // What the server holds now; anything else in `next` gets saved.
        synced.current = { key, json: server ? JSON.stringify(shared(server)) : JSON.stringify({ projects: [], assignments: {} }) };
        return { key, data: { ...previous.data, ...next } };
      });
      try { localStorage.setItem(mergedOnce, '1'); } catch { /* merged again next time; harmless */ }
      setReady(key);
    };
    void pull(true);
    // Another device may have changed them: look again when this one comes back.
    const onFocus = () => { if (document.visibilityState === 'visible') void pull(false); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onFocus); };
  }, [key, state.key]);
  useEffect(() => {
    if (ready !== key || state.key !== key || !synced.current || synced.current.key !== key) return;
    const json = JSON.stringify(shared(state.data));
    if (json === synced.current.json) return;
    const timer = setTimeout(() => {
      workspaceApi.putPersonalSetting(SETTING_KEY, shared(state.data))
        .then(() => { if (synced.current?.key === key) synced.current = { key, json }; })
        .catch(() => { /* Kept locally; saved with the next change. */ });
    }, 500);
    return () => clearTimeout(timer);
  }, [key, ready, state]);
  useEffect(() => {
    const created = (event: Event) => {
      const detail = (event as CustomEvent<{ workspace: string; viewer: string; thread: string }>).detail;
      if (!detail || detail.workspace !== workspace || detail.viewer !== viewer) return;
      setState(previous => {
        if (previous.key !== key || !previous.data.projects.some(p => p.id === previous.data.selected)) return previous;
        return { ...previous, data: { ...previous.data, assignments: { ...previous.data.assignments, [detail.thread]: previous.data.selected }, collapsed: previous.data.collapsed.filter(id => id !== previous.data.selected) } };
      });
    };
    window.addEventListener(THREAD_PROJECT_CREATED, created);
    return () => window.removeEventListener(THREAD_PROJECT_CREATED, created);
  }, [key, workspace, viewer]);
  const data = state.key === key ? state.data : empty();
  const update = (change: (previous: ThreadProjectState) => ThreadProjectState) => {
    if (key) setState(previous => ({ key, data: change(previous.key === key ? previous.data : empty()) }));
  };
  return {
    ...data,
    select: (selected: string) => update(s => ({ ...s, selected })),
    setGrouped: (grouped: boolean) => update(s => ({ ...s, grouped })),
    toggle: (id: string) => update(s => ({ ...s, collapsed: s.collapsed.includes(id) ? s.collapsed.filter(v => v !== id) : [...s.collapsed, id] })),
    create: (name: string) => {
      const id = crypto.randomUUID();
      update(s => ({ ...s, projects: [...s.projects, { id, name, color: s.projects.length % 5 }], collapsed: s.collapsed.filter(v => v !== id) }));
      return id;
    },
    reorder: (id: string, target: string, placement: 'before' | 'after') => update(s => {
      if (id === target || !s.projects.some(p => p.id === id) || !s.projects.some(p => p.id === target)) return s;
      const project = s.projects.find(p => p.id === id)!;
      const projects = s.projects.filter(p => p.id !== id);
      const index = projects.findIndex(p => p.id === target);
      projects.splice(index + (placement === 'after' ? 1 : 0), 0, project);
      return { ...s, projects };
    }),
    moveOrder: (id: string, direction: -1 | 1) => update(s => {
      const index = s.projects.findIndex(p => p.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= s.projects.length) return s;
      const projects = [...s.projects];
      [projects[index], projects[next]] = [projects[next], projects[index]];
      return { ...s, projects };
    }),
    rename: (id: string, name: string) => update(s => ({ ...s, projects: s.projects.map(p => p.id === id ? { ...p, name } : p) })),
    remove: (id: string) => update(s => ({ ...s, projects: s.projects.filter(p => p.id !== id), assignments: Object.fromEntries(Object.entries(s.assignments).filter(([, project]) => project !== id)), collapsed: s.collapsed.filter(v => v !== id), selected: s.selected === id ? 'all' : s.selected })),
    move: (thread: string, project: string | null) => update(s => {
      if (project && !s.projects.some(p => p.id === project)) return s;
      const assignments = { ...s.assignments };
      if (project) assignments[thread] = project; else delete assignments[thread];
      return { ...s, assignments, collapsed: s.collapsed.filter(v => v !== (project || 'unorganized')) };
    }),
  };
}
export type ThreadProjects = ReturnType<typeof useThreadProjects>;

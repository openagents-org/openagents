'use client';

import { useEffect, useRef, useState } from 'react';
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

/** Personal organization only: no thread metadata or permissions are changed. */
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

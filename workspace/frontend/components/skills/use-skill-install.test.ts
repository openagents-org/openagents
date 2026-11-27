// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Skill } from './skill-types';
import { useSkillInstall } from './use-skill-install';

const state = vi.hoisted(() => ({ status: {} as Record<string, unknown> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ workspaceApi: {} }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({
    agents: [{ agentName: 'claude', status: 'online', agentType: 'claude', enabledSkills: { skill_status: state.status } }],
    refreshWorkspace: vi.fn(),
  }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const REA_VIDEO: Skill = {
  id: 'rea-video', name: 'rea-video', category: 'ai-ml', tags: [],
  requiredFiles: ['SKILL.md', 'references/setup.md'],
};
const CLAUDE_API: Skill = { id: 'claude-api', name: 'Claude API', category: 'ai-ml', tags: [] };

let root: Root;
afterEach(async () => { await act(async () => root.unmount()); state.status = {}; });

async function probe(skill: Skill) {
  let result: ReturnType<typeof useSkillInstall> | undefined;
  function Probe() { result = useSkillInstall(skill); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(React.createElement(Probe)));
  return result!;
}

it('shows a partial install of a skill that needs its bundled files as incomplete', async () => {
  state.status = { 'rea-video': { state: 'installed', partial: true, updated_at: Date.now() } };
  expect((await probe(REA_VIDEO)).stateFor('claude')).toBe('incomplete');
});

it('keeps a partial install of other skills as installed', async () => {
  state.status = { 'claude-api': { state: 'installed', partial: true, updated_at: Date.now() } };
  expect((await probe(CLAUDE_API)).stateFor('claude')).toBe('installed');
});

it('passes the launcher error through for a failed install', async () => {
  state.status = { 'rea-video': { state: 'failed', error: 'Install Git there and retry.', updated_at: Date.now() } };
  const hook = await probe(REA_VIDEO);
  expect(hook.stateFor('claude')).toBe('failed');
  expect(hook.errorFor('claude')).toBe('Install Git there and retry.');
});

it('has no error for an installed skill', async () => {
  state.status = { 'rea-video': { state: 'installed', updated_at: Date.now() } };
  const hook = await probe(REA_VIDEO);
  expect(hook.stateFor('claude')).toBe('installed');
  expect(hook.errorFor('claude')).toBeUndefined();
});

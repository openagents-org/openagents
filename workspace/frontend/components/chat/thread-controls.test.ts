// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ access: { can_manage: false, can_add_people: false, can_add_agents: false, is_participant: false } }));
vi.mock('@/hooks/use-thread-access', () => ({ useThreadAccess: () => state.access }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ workflows: [], refreshAgents: vi.fn() }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
import { ResponseModeControl } from './response-mode-control';
import { AddThreadParticipants } from './add-thread-participants';
import { ThreadSettings } from './thread-settings';
import type { WorkspaceSession } from '@/lib/types';
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => { document.body.innerHTML = ''; });
const session = { sessionId: 'alpha', title: 'Alpha', participants: [], responseMode: 'proactive' } as unknown as WorkspaceSession;
it('shows no editing controls to a nonparticipant, including a nonparticipant admin', async () => {
  state.access = { can_manage: false, can_add_people: false, can_add_agents: false, is_participant: false };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(ResponseModeControl, { session, onChange: vi.fn() }), React.createElement(AddThreadParticipants, { channelName: 'alpha' }), React.createElement(ThreadSettings, { session }))));
  expect(host.querySelectorAll('button')).toHaveLength(0);
  expect(host.textContent).toContain('responseMode.proactive');
  await act(async () => root.unmount());
});
it('shows one combined add button and a single response menu to a joined admin', async () => {
  state.access = { can_manage: true, can_add_people: true, can_add_agents: true, is_participant: true };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(ResponseModeControl, { session, onChange: vi.fn() }), React.createElement(AddThreadParticipants, { channelName: 'alpha' }), React.createElement(ThreadSettings, { session }))));
  expect(host.querySelectorAll('button[aria-label="threadAccess.addParticipants"]')).toHaveLength(1);
  expect(host.querySelectorAll('button[aria-label^="responseMode.label"]')).toHaveLength(1);
  expect(host.querySelectorAll('button[aria-label="threadSettings.title"]')).toHaveLength(1);
  await act(async () => root.unmount());
});

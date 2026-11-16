// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import Page from '../app/[workspaceId]/page';
import { clearWorkspaceSnapshots } from './workspace-snapshot';
const mocks = vi.hoisted(() => ({ token: 'A', list: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ user:{email:'test@example.test'}, idToken:mocks.token, loading:false, isOpenAgentsDomain:true }) }));
vi.mock('@/lib/account-api', () => ({ listAccountWorkspaces: (...args: unknown[]) => mocks.list(...args) }));
vi.mock('@/lib/workspace-context', () => ({ WorkspaceProvider: ({children}:React.PropsWithChildren) => children, useWorkspace: () => ({currentUser:{name:'Test'},setUserName:vi.fn()}) }));
vi.mock('@/components/layout/layout-context', () => ({ LayoutProvider: ({children}:React.PropsWithChildren) => children }));
vi.mock('@/components/layout/wrapper', () => ({ Wrapper: () => React.createElement('div', null, 'Workspace opened') }));
vi.mock('@/components/campaign/campaign-feedback', () => ({ CampaignMilestoneToasts: () => null }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key:string) => key }));
vi.mock('@/lib/auth-redirects', () => ({ redirectToLogin:vi.fn(),goToCentralLogin:vi.fn() }));
const roster = [{slug:'test',workspaceId:'test',token:'workspace-key',role:'owner'}];
it('opens normally with a stable login token', async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); clearWorkspaceSnapshots(); mocks.token='A'; mocks.list.mockResolvedValue(roster);
  const host=document.createElement('div');const root=createRoot(host);const params=Promise.resolve({workspaceId:'test'});
  try {
    await act(async()=>{root.render(React.createElement(Page,{params}));});
    expect(host.textContent).toContain('Workspace opened');
  } finally { await act(async()=>root.unmount()); }
});
it('recovers when a pending lookup switches back to cached credentials', async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); clearWorkspaceSnapshots(); mocks.token='A';
  mocks.list.mockImplementation((token:string)=>token==='B'?new Promise(()=>{}):Promise.resolve(roster));
  const host=document.createElement('div');const root=createRoot(host);const params=Promise.resolve({workspaceId:'test'});
  const render=async()=>{await act(async()=>{root.render(React.createElement(Page,{params}));});};
  try {
    await render(); expect(host.textContent).toContain('Workspace opened');
    mocks.token='B'; await render(); expect(host.textContent).not.toContain('Workspace opened');
    mocks.token='A'; await render(); expect(host.textContent).toContain('Workspace opened');
  } finally { await act(async()=>root.unmount()); }
});

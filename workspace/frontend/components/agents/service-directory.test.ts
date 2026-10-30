// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
const mocks = vi.hoisted(() => ({ api: { listServices: vi.fn(), getTeam: vi.fn(), saveService: vi.fn(), startServiceRequest: vi.fn() }, setSession: vi.fn(), refresh: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: mocks.api }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ email: 'owner@test.com' }) }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ workspace: {workspaceId:'ws'}, agents: [{agentName:'helper',ownerEmail:'owner@test.com'}],setCurrentSessionId:mocks.setSession,refreshWorkspace:mocks.refresh }) }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({openView:mocks.open,isMobile:false}) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => translate(messages,messages,'en-US',key) }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: ({title,children}: any) => createElement('header',{},title,children) }));
vi.mock('./agent-avatar', () => ({ AgentAvatar: () => null }));
vi.mock('@/components/sharing/agent-access-section', () => ({ AgentAccessSection: (props: any) => createElement('div',{'data-resource':props.resourceKind,'data-id':props.agentName}) }));
vi.mock('@/components/ui/responsive-dialog', () => {
  const wrapper = ({children}: any) => createElement('div',{},children);
  return { Dialog: ({open,children}: any) => open ? wrapper({children}) : null, DialogContent:wrapper,DialogBody:wrapper,DialogFooter:wrapper,DialogHeader:wrapper,DialogTitle:wrapper,DialogDescription:wrapper };
});
import { ServiceDirectory } from './service-directory';
let root: Root, host: HTMLDivElement;
const service = {id:'review',agent_name:'helper',owner_email:'owner@test.com',name:'Review',description:'Code review',instructions:'Review only',example_requests:[],required_inputs:null,request_approver_email:null,can_manage:true};
const button = (label:string) => [...host.querySelectorAll('button')].find(b => b.textContent===label)!;
beforeEach(() => { vi.clearAllMocks(); Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); mocks.api.getTeam.mockResolvedValue([]); mocks.api.listServices.mockResolvedValue([service,{...service,id:'deploy',name:'Deploy'}]); mocks.api.startServiceRequest.mockResolvedValue({channel:'request-thread',title:'Review'}); host=document.createElement('div');document.body.append(host);root=createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('shows separate services backed by one agent and edits the service audience', async () => {
  await act(async () => root.render(createElement(ServiceDirectory)));
  expect(host.querySelectorAll('article')).toHaveLength(2);
  await act(async () => button('Edit service').click());
  expect(host.querySelector('[data-resource="service"]')?.getAttribute('data-id')).toBe('review');
  expect(host.querySelector('[data-resource="agent"]')).toBeNull();
});
it('routes requests through the selected service identity', async () => {
  await act(async () => root.render(createElement(ServiceDirectory)));
  await act(async () => button('Start a request').click());
  const area = host.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Review this change'); area.dispatchEvent(new Event('input',{bubbles:true})); });
  await act(async () => [...host.querySelectorAll('button')].filter(b => b.textContent==='Start a request').at(-1)!.click());
  expect(mocks.api.startServiceRequest).toHaveBeenCalledWith('review','Review this change');
  expect(mocks.setSession).toHaveBeenCalledWith('request-thread');
});

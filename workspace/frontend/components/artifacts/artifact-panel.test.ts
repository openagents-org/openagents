// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),pin:vi.fn(),selected:{kind:'file',id:'dashboard'} as any}));
vi.mock('@/lib/api',()=>({workspaceApi:{getThreadArtifact:mocks.get,pinThreadArtifact:mocks.pin}}));
vi.mock('@/lib/workspace-context',()=>({useWorkspace:()=>({currentSessionId:'general',files:[{id:'dashboard',filename:'dashboard.html',contentType:'text/html',channelName:'general'}],knowledge:[],browserTabs:[],refreshFiles:vi.fn(),refreshKnowledge:vi.fn(),refreshBrowserTabs:vi.fn()})}));
vi.mock('@/components/layout/layout-context',()=>({useLayout:()=>({selectedArtifact:mocks.selected,setSelectedArtifact:vi.fn(),setShowBrowserPreview:vi.fn()})}));
vi.mock('@/lib/i18n',()=>({useT:()=>(key:string)=>key}));
vi.mock('./artifact-content',()=>({ArtifactContent:()=>React.createElement('div',null,'dashboard preview')}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
import {ArtifactPanel} from './artifact-panel';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();mocks.selected={kind:'file',id:'dashboard'};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('allows the owner to pin the selected artifact and remove the default',async()=>{
  mocks.get.mockResolvedValue({artifact:null,can_pin:true,unavailable:false});
  mocks.pin.mockResolvedValueOnce({artifact:mocks.selected,can_pin:true,unavailable:false}).mockResolvedValueOnce({artifact:null,can_pin:true,unavailable:false});
  await act(async()=>root.render(React.createElement(ArtifactPanel)));
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="artifactPanel.pin"]')!.click());
  expect(mocks.pin).toHaveBeenLastCalledWith('general',{kind:'file',id:'dashboard'});
  expect(host.textContent).toContain('artifactPanel.pinnedHint');
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="artifactPanel.unpin"]')!.click());
  expect(mocks.pin).toHaveBeenLastCalledWith('general',null);
});
it('shows a member the pinned preview without owner controls',async()=>{
  mocks.get.mockResolvedValue({artifact:mocks.selected,can_pin:false,unavailable:false});
  await act(async()=>root.render(React.createElement(ArtifactPanel)));
  expect(host.textContent).toContain('dashboard preview');
  expect(host.querySelector('[aria-label="artifactPanel.pin"],[aria-label="artifactPanel.unpin"]')).toBeNull();
});
it('lets an owner clear an unavailable default',async()=>{
  mocks.selected=null;mocks.get.mockResolvedValue({artifact:null,can_pin:true,unavailable:true});
  mocks.pin.mockResolvedValue({artifact:null,can_pin:true,unavailable:false});
  await act(async()=>root.render(React.createElement(ArtifactPanel)));
  expect(host.textContent).toContain('artifactPanel.unavailable');
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="artifactPanel.unpin"]')!.click());
  expect(mocks.pin).toHaveBeenLastCalledWith('general',null);
});

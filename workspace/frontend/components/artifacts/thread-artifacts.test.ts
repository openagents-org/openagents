// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { artifactFromLink, openArtifactPreview } from '@/lib/thread-artifacts';
const mocks = vi.hoisted(() => ({
  workspace: { refreshBrowserTabs:vi.fn().mockResolvedValue(undefined),workspace:{workspaceId:'workspace',slug:'demo'}, currentSessionId:'one',currentUser:{id:'owner'},loading:false,files:[] as any[],browserTabs:[] as any[],sessions:[] as any[] },
  layout:{viewMode:'threads',openArtifact:vi.fn(),setSelectedArtifact:vi.fn(),setShowBrowserPreview:vi.fn(),setSplitBrowser:vi.fn()},
  get:vi.fn(),fetch:vi.fn(),knowledge:vi.fn(),
}));
vi.mock('@/lib/workspace-context',()=>({useWorkspace:()=>mocks.workspace}));
vi.mock('@/components/layout/layout-context',()=>({useLayout:()=>mocks.layout}));
vi.mock('@/lib/api',()=>({workspaceApi:{getBrowserTab:async(id:string)=>({id,status:'active'}),getThreadArtifact:mocks.get,fetchFile:mocks.fetch,getKnowledgeEntry:mocks.knowledge}}));
vi.mock('@/lib/openagents-auth-context',()=>({useOpenAgentsAuth:()=>({idToken:'signed-in'})}));
vi.mock('@/lib/i18n',()=>({useT:()=>(key:string)=>key}));
vi.mock('@/components/chat/markdown-content',()=>({MarkdownContent:({content}:any)=>React.createElement('article',null,content)}));
vi.mock('@/components/browser/browser-view',()=>({BrowserView:({artifactTabId}:any)=>React.createElement('div',{'data-browser':artifactTabId})}));
import { useThreadArtifactPreview } from './thread-artifact-controller';
import { ThreadArtifactLinks } from './thread-artifact-links';
import { ArtifactContent } from './artifact-content';
function Controller(){useThreadArtifactPreview();return null;}
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();mocks.workspace.currentSessionId='one';mocks.workspace.files=[];mocks.workspace.browserTabs=[];host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('restores the owner default on each entry and clears previews for an unpinned thread',async()=>{
  mocks.get.mockResolvedValueOnce({artifact:{kind:'file',id:'dashboard'}}).mockResolvedValueOnce({artifact:null});
  await act(async()=>root.render(React.createElement(Controller)));
  expect(mocks.layout.openArtifact).toHaveBeenCalledWith({kind:'file',id:'dashboard'});
  mocks.workspace.currentSessionId='two';
  await act(async()=>root.render(React.createElement(Controller)));
  expect(mocks.layout.setSelectedArtifact).toHaveBeenLastCalledWith(null);
  expect(mocks.layout.setShowBrowserPreview).toHaveBeenLastCalledWith(false);
  expect(mocks.layout.openArtifact).toHaveBeenCalledTimes(1);
});
it('ignores late default responses from a previous thread and respects a manual selection',async()=>{
  let resolveOne:(value:any)=>void=()=>{},resolveTwo:(value:any)=>void=()=>{};
  mocks.get.mockReturnValueOnce(new Promise(r=>{resolveOne=r;})).mockReturnValueOnce(new Promise(r=>{resolveTwo=r;}));
  await act(async()=>root.render(React.createElement(Controller)));
  mocks.workspace.currentSessionId='two';
  await act(async()=>root.render(React.createElement(Controller)));
  await act(async()=>openArtifactPreview({kind:'browser',id:'manual'}));
  await act(async()=>{resolveOne({artifact:{kind:'file',id:'old'}});resolveTwo({artifact:{kind:'file',id:'default'}});});
  expect(mocks.layout.openArtifact.mock.calls).toEqual([[{kind:'browser',id:'manual'}]]);
});
it('opens a helpful panel for an unavailable pin without exposing its reference',async()=>{
  mocks.get.mockResolvedValue({artifact:null,unavailable:true});
  await act(async()=>root.render(React.createElement(Controller)));
  expect(mocks.layout.setShowBrowserPreview).toHaveBeenLastCalledWith(true);
  expect(mocks.layout.openArtifact).not.toHaveBeenCalled();
});
it('recognizes canonical document links, uploaded paths, and existing live tabs',()=>{
  const files=[{id:'doc',filename:'uploaded_files/report.md'}] as any;
  // A just-published output is clickable before the files list refreshes.
  expect(artifactFromLink('/v1/files/aa111111-2222-4333-8444-555555555555',[],[],'demo')).toEqual({kind:'file',id:'aa111111-2222-4333-8444-555555555555'});
  expect(artifactFromLink('/demo/files/doc',files,[],'demo')).toEqual({kind:'file',id:'doc'});
  expect(artifactFromLink('/demo/knowledge/notes',files,[],'demo')).toEqual({kind:'knowledge',id:'notes'});
  expect(artifactFromLink('uploaded_files/report.md',files,[],'demo')).toEqual({kind:'file',id:'doc'});
  expect(artifactFromLink('https://evil.example/uploaded_files/report.md',files,[],'demo')).toBeNull();
  expect(artifactFromLink('/other/files/doc',[],[],'demo')).toBeNull();
  expect(artifactFromLink('https://example.com/',[],[{id:'tab',url:'https://example.com/'}] as any,'demo')).toEqual({kind:'browser',id:'tab'});
});
it('fetches HTML through the authenticated API and isolates scripts from the app origin',async()=>{
  mocks.workspace.files=[{id:'html',filename:'dashboard.html',contentType:'text/html'}];
  mocks.fetch.mockResolvedValue(new Response('<h1>Dashboard</h1><script>drawChart()</script>'));
  await act(async()=>root.render(React.createElement(ArtifactContent,{artifact:{kind:'file',id:'html'},revision:0})));
  expect(mocks.fetch).toHaveBeenCalledWith('html',expect.any(AbortSignal));
  const frame=host.querySelector('iframe')!;
  expect(frame.getAttribute('srcdoc')).toContain('Dashboard');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
});
it('renders markdown and rejects inaccessible document previews',async()=>{
  mocks.knowledge.mockResolvedValueOnce({content:'# Report'}).mockRejectedValueOnce(new Error('Forbidden'));
  await act(async()=>root.render(React.createElement(ArtifactContent,{artifact:{kind:'knowledge',id:'notes'},revision:0})));
  expect(host.textContent).toContain('# Report');
  await act(async()=>root.render(React.createElement(ArtifactContent,{artifact:{kind:'knowledge',id:'private'},revision:0})));
  expect(host.querySelector('[role=alert]')?.textContent).toBe('artifactPanel.unavailable');
  expect(host.textContent).not.toContain('# Report');
});
it('embeds the selected live browser with its existing controls',async()=>{
  mocks.workspace.browserTabs=[{id:'live'}];
  await act(async()=>root.render(React.createElement(ArtifactContent,{artifact:{kind:'browser',id:'live'},revision:0})));
  expect(host.querySelector('[data-browser=live]')).toBeTruthy();
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('opens links inside a document preview in the artifact panel',async()=>{
  mocks.get.mockResolvedValue({artifact:null});
  await act(async()=>root.render(React.createElement(Controller)));
  const panel=document.createElement('aside');panel.setAttribute('data-artifact-preview','');
  const link=document.createElement('a');link.href='/v1/files/cc111111-2222-4333-8444-555555555555';panel.append(link);host.append(panel);
  await act(async()=>link.click());
  expect(mocks.layout.openArtifact).toHaveBeenLastCalledWith({kind:'file',id:'cc111111-2222-4333-8444-555555555555'});
});

it('rejects placeholder file IDs while supporting real new uploads and known legacy IDs',()=>{
  for(const id of ['RETURNED_PROJECT_ID','FILE_ID','example','<file-id>']) {
    expect(artifactFromLink(`/v1/files/${encodeURIComponent(id)}`,[],[],'demo')).toBeNull();
    expect(artifactFromLink(`/demo/files/${encodeURIComponent(id)}`,[],[],'demo')).toBeNull();
  }
  expect(artifactFromLink('/v1/files/legacy-file',[{id:'legacy-file',filename:'report.md'}] as any,[],'demo')).toEqual({kind:'file',id:'legacy-file'});
});

it('uses stable browser IDs across navigation and rejects example IDs',()=>{
  const id='dd111111-2222-4333-8444-555555555555';
  expect(artifactFromLink(`/v1/browser/tabs/${id}`,[],[],'demo')).toEqual({kind:'browser',id});
  expect(artifactFromLink(`/v1/browser/tabs/${id}`,[],[{id,url:'https://new.example/'}] as any,'demo')).toEqual({kind:'browser',id});
  expect(artifactFromLink('/v1/browser/tabs/TAB_ID',[],[],'demo')).toBeNull();
  expect(artifactFromLink(`https://external.example/v1/browser/tabs/${id}`,[],[],'demo')).toBeNull();
});

it('keeps a browser shortcut after activity expires only in its associated thread',async()=>{
  mocks.workspace.browserTabs=[{id:'live',url:'https://example.com/',title:'Example',status:'active',createdBy:'openagents:agent',artifactChannels:['one'],activity:null}];
  await act(async()=>root.render(React.createElement(ThreadArtifactLinks)));
  expect(host.textContent).toContain('Example');
  const opened=vi.fn(); window.addEventListener('workspace:open-artifact',opened);
  await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Example')!.click());
  expect(opened.mock.calls[0][0].detail).toEqual({kind:'browser',id:'live'});
  window.removeEventListener('workspace:open-artifact',opened);
  mocks.workspace.currentSessionId='two';
  await act(async()=>root.render(React.createElement(ThreadArtifactLinks)));
  expect(host.textContent).not.toContain('Example');
});

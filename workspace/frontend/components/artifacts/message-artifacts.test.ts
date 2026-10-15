// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const opened=vi.fn();
vi.mock('./browser-thumbnail',()=>({BrowserThumbnail:()=>null}));
vi.mock('@/lib/workspace-context',()=>({useWorkspace:()=>({workspace:{slug:'demo'},files:[],browserTabs:[{id:'tab',url:'https://example.com/'}]})}));
vi.mock('@/lib/i18n',()=>({useT:()=>(key:string)=>key}));
import { MessageArtifacts } from './message-artifacts';
import { ARTIFACT_OPEN_EVENT } from '@/lib/thread-artifacts';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});opened.mockClear();host=document.createElement('div');document.body.append(host);root=createRoot(host);window.addEventListener(ARTIFACT_OPEN_EVENT,opened);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();window.removeEventListener(ARTIFACT_OPEN_EVENT,opened);});
it('opens a just-created HTML report from its preview card before the file list refreshes',async()=>{
  await act(async()=>root.render(React.createElement(MessageArtifacts,{content:'Created [mcp-report.html](/v1/files/bb111111-2222-4333-8444-555555555555).',attachedIds:[]})));
  expect(host.textContent).toContain('mcp-report.html');
  await act(async()=>host.querySelector('button')!.click());
  expect(opened.mock.calls[0][0].detail).toEqual({kind:'file',id:'bb111111-2222-4333-8444-555555555555'});
});
it('avoids duplicate attachment cards and links inside code samples',async()=>{
  await act(async()=>root.render(React.createElement(MessageArtifacts,{content:'[report](/v1/files/bb111111-2222-4333-8444-555555555555)\n```md\n[example](/v1/files/example)\n```',attachedIds:['bb111111-2222-4333-8444-555555555555']})));
  expect(host.querySelector('button')).toBeNull();
});
it('opens shared browser links but never pretends an unuploaded device file is available',async()=>{
  await act(async()=>root.render(React.createElement(MessageArtifacts,{content:'[Report](/home/agent/mcp-report.html) [Live dashboard](https://example.com/)',attachedIds:[]})));
  expect(host.querySelectorAll('button')).toHaveLength(1);
  await act(async()=>host.querySelector('button')!.click());
  expect(opened.mock.calls[0][0].detail).toEqual({kind:'browser',id:'tab'});
});

it('ignores placeholder links and inline Markdown examples',async()=>{
  await act(async()=>root.render(React.createElement(MessageArtifacts,{content:'Reply with [your project name](/v1/files/RETURNED_PROJECT_ID). Example: `[report](/v1/files/bb111111-2222-4333-8444-555555555555)` and ``[report](/demo/files/bb111111-2222-4333-8444-555555555555)``.',attachedIds:[]})));
  expect(host.querySelector('button')).toBeNull();
});

it('opens a new live tab by ID before polling discovers it',async()=>{
  const id='dd111111-2222-4333-8444-555555555555';
  await act(async()=>root.render(React.createElement(MessageArtifacts,{content:`Opened a [live browser tab](/v1/browser/tabs/${id}).`,attachedIds:[]})));
  await act(async()=>host.querySelector('button')!.click());
  expect(opened.mock.calls[0][0].detail).toEqual({kind:'browser',id});
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetchFile: vi.fn(), token: 'sam-session', user: null as null | { email: string } }));
vi.mock('@/lib/api', () => ({ workspaceApi: {fetchFile:mocks.fetchFile} }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({idToken:mocks.token,user:mocks.user}) }));
import { resetFileObjectUrlCache, useFileObjectUrl } from './use-file-object-url';
let host:HTMLDivElement, root:Root;
function Media() { const state=useFileObjectUrl('private-image'); return createElement('span',{},state.failed?'failed':state.url || 'loading'); }
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  mocks.token='sam-session'; mocks.user=null; mocks.fetchFile.mockReset().mockResolvedValue({blob:async()=>new Blob(['image'])});
  URL.createObjectURL=vi.fn().mockReturnValue('blob:authenticated'); URL.revokeObjectURL=vi.fn();
  host=document.createElement('div');root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount()); resetFileObjectUrlCache();});
it('loads private media through authenticated fetch and revokes it when the viewer changes',async()=>{
  await act(async()=>root.render(createElement(Media)));
  expect(mocks.fetchFile).toHaveBeenCalledWith('private-image',expect.any(AbortSignal));
  expect(host.textContent).toBe('blob:authenticated');
  mocks.token='another-session';
  await act(async()=>root.render(createElement(Media)));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authenticated');
  expect(mocks.fetchFile).toHaveBeenCalledTimes(2);
});
it('shows failure without falling back to an unauthenticated URL',async()=>{
  mocks.fetchFile.mockRejectedValue(new Error('403'));
  await act(async()=>root.render(createElement(Media)));
  expect(host.textContent).toBe('failed');expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('reuses one download across remounts and viewers of the same file',async()=>{
  mocks.token='reuse-session';
  function Two() { const a=useFileObjectUrl('shared-image'); const b=useFileObjectUrl('shared-image'); return createElement('span',{},`${a.url||'-'}|${b.url||'-'}`); }
  await act(async()=>root.render(createElement(Two)));
  expect(host.textContent).toBe('blob:authenticated|blob:authenticated');
  await act(async()=>root.render(createElement('span',{},'hidden')));
  await act(async()=>root.render(createElement(Two)));
  expect(host.textContent).toBe('blob:authenticated|blob:authenticated');
  expect(mocks.fetchFile).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});
it('does not download until enabled, but shows what is already cached',async()=>{
  mocks.token='lazy-session';
  function Lazy({enabled}:{enabled:boolean}) { const s=useFileObjectUrl('lazy-image',{enabled}); return createElement('span',{},s.url||'waiting'); }
  await act(async()=>root.render(createElement(Lazy,{enabled:false})));
  expect(host.textContent).toBe('waiting');expect(mocks.fetchFile).not.toHaveBeenCalled();
  await act(async()=>root.render(createElement(Lazy,{enabled:true})));
  expect(host.textContent).toBe('blob:authenticated');
  await act(async()=>root.render(createElement('span',{},'hidden')));
  await act(async()=>root.render(createElement(Lazy,{enabled:false})));
  expect(host.textContent).toBe('blob:authenticated');expect(mocks.fetchFile).toHaveBeenCalledTimes(1);
});
it('keeps cached images across the hourly sign-in token refresh',async()=>{
  mocks.user={email:'sam@example.com'};
  await act(async()=>root.render(createElement(Media)));
  mocks.token='refreshed-session';
  await act(async()=>root.render(createElement(Media)));
  expect(host.textContent).toBe('blob:authenticated');
  expect(mocks.fetchFile).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

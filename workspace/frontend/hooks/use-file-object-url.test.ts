// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetchFile: vi.fn(), token: 'sam-session' }));
vi.mock('@/lib/api', () => ({ workspaceApi: {fetchFile:mocks.fetchFile} }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({idToken:mocks.token}) }));
import { useFileObjectUrl } from './use-file-object-url';
let host:HTMLDivElement, root:Root;
function Media() { const state=useFileObjectUrl('private-image'); return createElement('span',{},state.failed?'failed':state.url || 'loading'); }
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  mocks.token='sam-session'; mocks.fetchFile.mockReset().mockResolvedValue({blob:async()=>new Blob(['image'])});
  URL.createObjectURL=vi.fn().mockReturnValue('blob:authenticated'); URL.revokeObjectURL=vi.fn();
  host=document.createElement('div');root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());});
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

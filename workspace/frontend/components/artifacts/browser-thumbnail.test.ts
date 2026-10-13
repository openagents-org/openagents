// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workspaceApi } from '@/lib/api';
vi.mock('@/lib/openagents-auth-context',()=>({useOpenAgentsAuth:()=>({idToken:'viewer'})}));
vi.mock('@/lib/i18n',()=>({useT:()=>(key:string)=>key}));
import { BrowserThumbnail } from './browser-thumbnail';
let host:HTMLDivElement,root:Root,seen:(entries:any[])=>void;
let fetchFrame:ReturnType<typeof vi.spyOn>;
let create=vi.fn<(object: Blob | MediaSource) => string>();
let revoke=vi.fn<(url: string) => void>();
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver',class {
    constructor(callback:any){seen=callback;}
    observe(){} disconnect(){}
  });
  create=vi.fn().mockReturnValue('blob:preview'); revoke=vi.fn();
  vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=revoke;});
  fetchFrame=vi.spyOn(workspaceApi,'fetchBrowserScreenshot').mockImplementation(async()=>new Response(new Blob(['frame'],{type:'image/png'})));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
const render=(enabled=true,pageUrl='https://example.com/')=>act(async()=>root.render(React.createElement(BrowserThumbnail,{tabId:'tab',pageUrl,title:'Example',enabled})));
it('loads only on screen, pauses off screen, and refreshes visible cards',async()=>{
  await render();expect(fetchFrame).not.toHaveBeenCalled();
  await act(async()=>seen([{isIntersecting:true}]));
  expect(fetchFrame).toHaveBeenCalledWith('tab',expect.any(AbortSignal));
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:preview');
  await act(async()=>{seen([{isIntersecting:false}]);vi.advanceTimersByTime(30000);});
  expect(fetchFrame).toHaveBeenCalledTimes(1);
  await act(async()=>seen([{isIntersecting:true}]));
  expect(fetchFrame).toHaveBeenCalledTimes(2);
  expect(revoke).toHaveBeenCalledWith('blob:preview');
});
it('invalidates the old frame on navigation and cleans up its request',async()=>{
  await render();await act(async()=>seen([{isIntersecting:true}]));
  const signal=fetchFrame.mock.calls[0][1];
  await render(true,'https://new.example/');
  expect(signal?.aborted).toBe(true);
  expect(revoke).toHaveBeenCalledWith('blob:preview');
  expect(host.querySelector('img')).toBeNull();
  await act(async()=>seen([{isIntersecting:true}]));
  expect(fetchFrame).toHaveBeenCalledTimes(2);
});
it('leaves a quiet fallback if capture fails or the tab is sleeping',async()=>{
  fetchFrame.mockRejectedValue(new Error('Tab unavailable'));
  await render();await act(async()=>seen([{isIntersecting:true}]));
  expect(host.textContent).toContain('browser.thumbnailUnavailable');
  expect(host.querySelector('img')).toBeNull();
  await render(false);await act(async()=>vi.advanceTimersByTime(30000));
  expect(fetchFrame).toHaveBeenCalledTimes(1);
});
it('sends viewer credentials as headers, never in the screenshot URL',async()=>{
  fetchFrame.mockRestore();
  const fetch=vi.fn().mockResolvedValue(new Response(new Blob(['image'])));
  vi.stubGlobal('fetch',fetch);
  workspaceApi.configure('workspace','workspace-secret','viewer-secret');
  await workspaceApi.fetchBrowserScreenshot('tab');
  expect(fetch.mock.calls[0][0]).toMatch(/\/v1\/browser\/tabs\/tab\/screenshot$/);
  expect(fetch.mock.calls[0][1].headers).toEqual({'X-Workspace-Token':'workspace-secret',Authorization:'Bearer viewer-secret'});
  workspaceApi.configure('','','');
});

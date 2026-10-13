// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({preview:vi.fn()}));
vi.mock('@/lib/api',()=>({workspaceApi:{previewWebProject:mocks.preview}}));
vi.mock('@/lib/openagents-auth-context',()=>({useOpenAgentsAuth:()=>({idToken:'member'})}));
vi.mock('@/lib/i18n',()=>({useT:()=>(key:string)=>key}));
vi.mock('./project-upload',()=>({ProjectUpload:()=>React.createElement('button',null,'Update project')}));
import {ProjectPreview} from './project-preview';
import {projectFiles} from '@/lib/web-projects';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('previews the entry URL with relative assets in an isolated frame',async()=>{
  mocks.preview.mockResolvedValue({id:'p',entrypoint:'index.html',files:['index.html','images/chart.png'],can_update:true,revision:'one',preview_path:'https://example.test/v1/project-preview/scoped/index.html'});
  await act(async()=>root.render(React.createElement(ProjectPreview,{id:'p'})));
  const frame=host.querySelector('iframe')!;
  expect(frame.src).toContain('/project-preview/scoped/index.html');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(host.textContent).toContain('Update project');
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-expanded]')!.click());
  expect(host.textContent).toContain('images/chart.png');
});
it('does not expose a stale preview when the project changes or access fails',async()=>{
  mocks.preview.mockResolvedValueOnce({entrypoint:'index.html',files:[],can_update:false,preview_path:'https://example.test/old'}).mockRejectedValueOnce(new Error('not available'));
  await act(async()=>root.render(React.createElement(ProjectPreview,{id:'old'})));
  expect(host.querySelector('iframe')).not.toBeNull();
  await act(async()=>root.render(React.createElement(ProjectPreview,{id:'private'})));
  expect(host.querySelector('iframe')).toBeNull();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it('keeps relative folder structure and excludes hidden files and dependencies',()=>{
  const files=['site/index.html','site/assets/plot.png','site/.env','site/node_modules/lib/x.js'].map(path=>{
    const file=new File(['data'],path.split('/').at(-1)!);Object.defineProperty(file,'webkitRelativePath',{value:path});return file;
  });
  expect(projectFiles(files).map(f=>f.path)).toEqual(['index.html','assets/plot.png']);
});

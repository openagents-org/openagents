// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({avatarUrl:'https://images.example.com/person.png'}));
vi.mock('@/hooks/use-team-roster',()=>({useTeamRoster:()=>[{email:'person@example.com',avatarUrl:state.avatarUrl}]}));
import { HumanAvatar } from './human-avatar';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
it('uses the custom avatar, falls back on failure, and retries a changed photo',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    const render=()=>act(async()=>root.render(React.createElement(HumanAvatar,{email:'PERSON@example.com'})));
    await render();expect(host.querySelector('img')?.getAttribute('src')).toBe(state.avatarUrl);
    await act(async()=>host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();expect(host.querySelector('svg')).not.toBeNull();
    state.avatarUrl='https://images.example.com/new.png';await render();expect(host.querySelector('img')?.getAttribute('src')).toBe(state.avatarUrl);
  } finally {await act(async()=>root.unmount());host.remove();}
});

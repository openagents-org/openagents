// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({getReactions:vi.fn(),setReaction:vi.fn()}));
vi.mock('@/lib/api',()=>({workspaceApi:mocks}));
vi.mock('@/lib/workspace-context',()=>({useWorkspace:()=>({workspace:{workspaceId:'ws'}})}));
vi.mock('@/hooks/use-me',()=>({useMe:()=>({email:'sam@test.com'})}));
vi.mock('@/lib/i18n',()=>({useT:()=>(key:string)=>key}));
import { MessageReactions, MessageReactionsProvider } from './message-reactions';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);mocks.getReactions.mockResolvedValue({'human-message':[]});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('adds and removes the current person’s reaction on a human message',async()=>{
 const message={messageId:'human-message',sessionId:'thread',senderType:'human',messageType:'chat'} as any;
 await act(async()=>root.render(createElement(MessageReactionsProvider,{messages:[message],children:createElement(MessageReactions,{messageId:message.messageId})})));
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="reactions.add"]')!.click());
 mocks.setReaction.mockResolvedValue([{emoji:'👍',count:1,mine:true}]);
 await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='👍')!.click());
 expect(mocks.setReaction).toHaveBeenLastCalledWith('human-message','👍',true);
 expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe('👍 1');
 mocks.setReaction.mockResolvedValue([]);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!.click());
 expect(mocks.setReaction).toHaveBeenLastCalledWith('human-message','👍',false);
 expect(host.querySelector('[aria-pressed]')).toBeNull();
});
it('keeps existing reactions visible and groups Reply with the hover actions',async()=>{
 const reply=vi.fn();mocks.getReactions.mockResolvedValue({'human-message':[{emoji:'👍',count:2,mine:false}]});
 const message={messageId:'human-message',sessionId:'thread',senderType:'human',messageType:'chat'} as any;
 await act(async()=>root.render(createElement(MessageReactionsProvider,{messages:[message],children:createElement(MessageReactions,{messageId:message.messageId,onReply:reply})})));
 const add=host.querySelector<HTMLButtonElement>('[aria-label="reactions.add"]')!;
 const replyButton=host.querySelector<HTMLButtonElement>('[aria-label="reactions.reply"]')!;
 expect(add.parentElement).toBe(replyButton.parentElement);
 expect(add.parentElement?.className).toContain('group-hover/message:opacity-100');
 expect(add.parentElement?.className).toContain('focus-within:opacity-100');
 expect(add.parentElement?.contains(host.querySelector('[aria-pressed]'))).toBe(false);
 await act(async()=>replyButton.click());expect(reply).toHaveBeenCalledOnce();
});

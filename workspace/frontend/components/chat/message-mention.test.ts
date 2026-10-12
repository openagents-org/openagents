// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/workspace-context',()=>({useWorkspace:()=>({currentUser:{id:'me@example.com',isAuthenticated:true}})}));
vi.mock('@/hooks/use-team-roster',()=>({useHumanNames:()=>({'li@example.com':'李红梦'})}));
vi.mock('@/lib/i18n',()=>({useT:()=>(key:string)=>key,useFormatters:()=>({formatTime:()=>''})}));
vi.mock('./markdown-content',()=>({MarkdownContent:()=>null}));
vi.mock('./message-reactions',()=>({MessageReactions:({onReply}:any)=>onReply?React.createElement('button',{onClick:onReply},'Reply'):null}));
import { ChatMessage } from './chat-message';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const message={messageId:'message',senderType:'human',senderName:'李红梦',senderAddress:'human:li@example.com',messageType:'chat',content:'hello',sessionId:'thread'} as any;
it('uses the stable sender identity when clicking the name or Reply',async()=>{
 const mention=vi.fn();await act(async()=>root.render(React.createElement(ChatMessage,{message,onMentionPerson:mention})));
 const buttons=Array.from(host.querySelectorAll('button'));
 await act(async()=>buttons.find(b=>b.textContent==='李红梦')!.click());
 expect(mention).toHaveBeenLastCalledWith('li@example.com');
 await act(async()=>buttons.find(b=>b.textContent==='Reply')!.click());
 expect(mention).toHaveBeenCalledTimes(2);
 expect(host.firstElementChild?.className).toContain('group/message');
});
it('does not create a mention from an ambiguous legacy sender name',async()=>{
 const mention=vi.fn();await act(async()=>root.render(React.createElement(ChatMessage,{message:{...message,senderAddress:'human:user'},onMentionPerson:mention})));
 expect(host.querySelector('button')).toBeNull();expect(host.textContent).toContain('李红梦');
});

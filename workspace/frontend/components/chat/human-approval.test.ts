// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { approvalFromMetadata } from '@/lib/approvals';
import { eventToMessage } from '@/lib/types';
const mocks = vi.hoisted(() => ({ email: 'maya@example.com', pending: [] as any[], resolveApproval: vi.fn(), refreshApprovals: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: { resolveApproval: mocks.resolveApproval, getApproval: vi.fn().mockRejectedValue(new Error('not needed')) } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ currentUser: { id: mocks.email, isAuthenticated: true }, workspace: { workspaceId: 'workspace', requireLogin: true }, pendingApprovals: mocks.pending, refreshApprovals: mocks.refreshApprovals }) }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ email: mocks.email, role: 'member', tokenAccess: false }) }));
vi.mock('@/hooks/use-team-roster', () => ({ useHumanNames: () => ({ 'sam@example.com': 'Sam Okafor' }), useTeamRoster: () => [{ email:'sam@example.com',displayName:'Sam Okafor' },{ email:'maya@example.com',displayName:'Maya Chen',avatarUrl:'https://images.example.com/maya.png' }] }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, args?: Record<string,string>) => key + (args ? ' ' + Object.values(args).join(' ') : ''), useFormatters: () => ({ formatTime: () => '08:22' }) }));
vi.mock('./markdown-content', () => ({ MarkdownContent: ({ content }: any) => React.createElement('p',null,content) }));
vi.mock('./message-reactions', () => ({ MessageReactions: ({ onReply, onRecall }: any) => React.createElement('span',null,'reaction controls', onReply && React.createElement('button', { onClick: onReply }, 'Reply'), onRecall && React.createElement('button', { onClick: onRecall }, 'Recall')) }));
import { ChatMessage } from './chat-message';
const raw = { id:'approval-1', channel_name:'general', requested_by:'claude-dev', kind:'thread_agent_request', action:'Start a task with claude-dev', details:'@claude-dev hey', required_role:'any', assignee_email:'maya@example.com', status:'pending', policy_requirements:{ members:['maya@example.com'], approved_by:[], role_required:null, role_approved:false } };
const message = eventToMessage({ id:'request-message', source:'human:sam@example.com', target:'channel/general', timestamp:1, payload:{ message_type:'approval',content:'plain fallback kind: thread_agent_request',approval:raw } } as any);
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();mocks.email='maya@example.com';mocks.pending=[approvalFromMetadata({approval:raw})];mocks.refreshApprovals.mockResolvedValue(undefined);host=document.createElement('div');document.body.append(host);root=createRoot(host); });
afterEach(async () => { await act(async()=>root.unmount());host.remove(); });
it.each(['approve','reject'] as const)('lets the named owner %s directly in the human request card', async decision => {
  mocks.resolveApproval.mockResolvedValue({ ...mocks.pending[0],status:decision==='approve'?'approved':'rejected',resolvedBy:'maya@example.com' });
  await act(async()=>root.render(React.createElement(ChatMessage,{message})));
  expect(host.textContent).toContain('Sam Okafor');
  expect(host.textContent).toContain('Start a task with claude-dev');
  expect(host.textContent).not.toContain('plain fallback');
  expect(host.textContent).not.toContain('reaction controls');
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===`approvals.${decision}`)!;
  expect(button).toBeTruthy();
  await act(async()=>button.click());
  expect(mocks.resolveApproval).toHaveBeenCalledWith('approval-1',decision,undefined);
  expect(mocks.refreshApprovals).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Maya Chen');
  expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='approvals.approve')).toBe(false);
});
it('shows the request to Sam without giving him the owner’s decision buttons', async()=>{
  mocks.email='sam@example.com';
  await act(async()=>root.render(React.createElement(ChatMessage,{message})));
  expect(host.textContent).toContain('Start a task with claude-dev');
  expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='approvals.approve'||b.textContent==='approvals.reject')).toBe(false);
  expect(mocks.resolveApproval).not.toHaveBeenCalled();
});

it('Reply selects the exact original message instead of merely mentioning its author', async () => {
  const chat = { ...message, messageType: 'chat', content: 'Which release?', metadata: {} };
  const reply = vi.fn(), mention = vi.fn();
  await act(async () => root.render(React.createElement(ChatMessage, { message: chat, onReply: reply, onMentionPerson: mention })));
  await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Reply')!.click());
  expect(reply).toHaveBeenCalledWith(chat);
  expect(mention).not.toHaveBeenCalled();
});
it('offers Recall only for your unassigned messages and hides the withdrawn body', async () => {
  const chat = { ...message, messageType: 'chat', senderId: mocks.email, content: 'Withdraw this', targetAgents: ['__no_response__'], metadata: {} };
  const recall = vi.fn();
  await act(async () => root.render(React.createElement(ChatMessage, { message: chat, onRecall: recall })));
  expect(host.textContent).toContain('Recall');
  await act(async () => root.render(React.createElement(ChatMessage, { message: { ...chat, targetAgents: ['claude-dev'] }, onRecall: recall })));
  expect(host.textContent).not.toContain('Recall');
  await act(async () => root.render(React.createElement(ChatMessage, { message: { ...chat, metadata: { recalled: true } }, onRecall: recall })));
  expect(host.textContent).not.toContain('Withdraw this');
  expect(host.textContent).not.toContain('reaction controls');
});

it('uses the current profile photo for your thread messages', async () => {
  const chat = { ...message, senderAddress: 'human:maya@example.com', senderId: 'maya@example.com', messageType: 'chat', content: 'Hi', metadata: {} };
  await act(async () => root.render(React.createElement(ChatMessage, { message: chat })));
  expect(host.querySelector('img')?.getAttribute('src')).toBe('https://images.example.com/maya.png');
});


it.each([{}, { require_human: true, resume_in_place: true }, { members: ['maya@example.com'] }])('renders incomplete approval metadata without crashing the thread: %j', async policy => {
  const approval = { ...raw, policy_requirements: policy };
  const msg = eventToMessage({ id: 'partial-approval', source: 'openagents:gpu-ca1', target: 'channel/general', timestamp: 1,
    payload: { message_type: 'approval', content: 'request', approval } } as any);
  mocks.pending = [{ ...approvalFromMetadata({ approval }), policyRequirements: policy }];
  await act(async () => root.render(React.createElement(ChatMessage, { message: msg })));
  expect(host.textContent).toContain(raw.action);
  expect(host.textContent).not.toContain('Application error');
});

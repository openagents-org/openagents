import { expect, it } from 'vitest';
import { filterThreadSteps, groupMessages } from './chat-message-groups';
import type { WorkspaceMessage } from '@/lib/types';

let seq = 0;
const msg = (messageType: string, content: string, senderName = 'kimi'): WorkspaceMessage => ({
  messageId: `m${++seq}`, sessionId: 'dm', senderType: senderName === 'You' ? 'human' : 'agent', senderName, content, messageType,
} as WorkspaceMessage);
const types = (messages: WorkspaceMessage[]) => messages.map((m) => `${m.messageType}:${m.content}`);

it('keeps the steps of a finished run so they fold into a summary line', () => {
  const run = [msg('chat', 'go', 'You'), msg('status', '**Running:** `ls`'), msg('status', '**Editing:** `a.ts`'), msg('chat', 'done')];
  expect(types(filterThreadSteps(run))).toEqual(types(run));
  expect(groupMessages(filterThreadSteps(run)).map((g) => g.type)).toEqual(['chat', 'steps', 'chat']);
});

it('drops empty steps', () => {
  expect(types(filterThreadSteps([msg('chat', 'go', 'You'), msg('status', '  '), msg('todos', '')]))).toEqual(['chat:go']);
});

it('drops thinking that only previewed the reply', () => {
  const list = [msg('chat', 'go', 'You'), msg('thinking', 'The answer is...'), msg('chat', 'The answer is 42')];
  expect(types(filterThreadSteps(list))).toEqual(['chat:go', 'chat:The answer is 42']);
});

it('folds alternating thoughts, tools and tasks into one run without hiding replies', () => {
  const first = msg('chat', 'start', 'You');
  const activity = [msg('thinking', 'Inspecting the code'), msg('status', '**Running:** `ls`'), msg('todos', 'task snapshot'), msg('thinking', 'Now checking tests')];
  const reply = msg('chat', 'Here is the result');
  const groups = groupMessages([first, ...activity, reply]);
  expect(groups.map(group => group.type)).toEqual(['chat', 'steps', 'chat']);
  expect(groups[1]).toEqual({ type: 'steps', messages: activity });
});

it('keeps approvals and human interjections outside activity disclosures', () => {
  const groups = groupMessages([msg('thinking', 'checking'), msg('approval', 'Approve execution?'), msg('status', 'working'), msg('chat', 'wait', 'You')]);
  expect(groups.map(group => group.type)).toEqual(['steps', 'chat', 'steps', 'chat']);
});

it('starts fresh activity after a stopped run', () => {
  const groups = groupMessages([msg('status', 'Stopped'), msg('thinking', 'Trying again')]);
  expect(groups.map(group => group.type)).toEqual(['steps', 'steps']);
});

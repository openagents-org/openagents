// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IssueDiscussion } from './issue-discussion';

const api = vi.hoisted(() => ({ getIssue: vi.fn(), commentOnIssue: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: api }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: () => null }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgo: () => 'just now' }) }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  currentUser: { id: 'alice@example.com', name: 'Alice' }, sessions: [], agents: [],
  workspace: { slug: 'test' }, refreshAgents: vi.fn(),
}) }));
vi.mock('@/components/chat/markdown-content', () => ({ MarkdownContent: ({ content }: { content: string }) => createElement('p', {}, content) }));
vi.mock('@/components/tasks/task-chat-popup', () => ({ TaskChatPopup: () => null }));
vi.mock('@/components/chat/approval-card', () => ({ ApprovalCard: () => null }));
vi.mock('./issue-work', () => ({ IssueWork: () => null }));
vi.mock('./issue-properties', () => ({ IssueProperties: () => null }));
vi.mock('./issue-editor', () => ({ IssueEditor: () => null }));
vi.mock('./issue-attachments', () => ({ IssueAttachments: () => null }));
vi.mock('./add-issue-participants', () => ({ AddIssueParticipants: () => null }));
vi.mock('./use-issue-mentions', () => ({ useIssueMentions: () => [
  { kind: 'agent', source: 'openagents:coder', token: 'coder', name: 'Coder' },
] }));
vi.mock('@/hooks/use-team-roster', () => ({ useTeamRoster: () => [] }));

let root: Root, host: HTMLDivElement;
const issue = {
  id: 'issue', title: 'Example', description: '', status: 'in_progress', created_by: 'human:alice@example.com',
  created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z', labels: [],
  participants: [{ source: 'openagents:coder', name: 'Coder' }], threads: [],
  comments: [{ id: 'answer', author: 'openagents:coder', author_name: 'Coder', content: 'Finished the fix',
    kind: 'result', source_event_id: 'answer', reply_channel_name: 'original-thread', created_at: '2026-10-26T00:00:00Z' }],
};
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  api.getIssue.mockResolvedValue(issue);
  api.commentOnIssue.mockResolvedValue({});
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });
async function render() {
  await act(async () => root.render(createElement(IssueDiscussion, { id: 'issue', onBack: vi.fn(), onChanged: vi.fn() })));
}
it('Reply prefills the agent and submits the exact source event, then clears the reply', async () => {
  await render();
  await act(async () => button('issues.reply').click());
  expect(host.querySelector('textarea')!.value).toContain('@Coder');
  expect(host.textContent).toContain('issues.replyingTo');
  await act(async () => button('issues.postComment').click());
  expect(api.commentOnIssue).toHaveBeenCalledWith('issue', expect.objectContaining({
    content: '@coder ', reply_to_event_id: 'answer', source: 'human:alice@example.com',
  }));
  expect(host.querySelector('textarea')!.value).toBe('');
  expect(host.textContent).not.toContain('issues.replyingTo');
});
it('keeps the draft and reply target when submission fails', async () => {
  api.commentOnIssue.mockRejectedValue(new Error('Could not save'));
  await render();
  await act(async () => button('issues.reply').click());
  await act(async () => button('issues.postComment').click());
  expect(host.textContent).toContain('Could not save');
  expect(host.textContent).toContain('issues.replyingTo');
  expect(host.querySelector('textarea')!.value).toContain('@Coder');
});
it('does not offer Reply for a shared result whose original thread is inaccessible', async () => {
  api.getIssue.mockResolvedValue({ ...issue, comments: [{ ...issue.comments[0], reply_channel_name: null }] });
  await render();
  expect(button('issues.reply')).toBeUndefined();
});

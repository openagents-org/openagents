// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { IssueDetail, KanbanTask } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  ws: {
    workspace: { workspaceId: 'workspace-1' },
    currentUser: { id: 'alice-id', name: 'Alice' },
    agents: [] as unknown[],
    sessions: [],
    tasks: [] as KanbanTask[],
    workflows: [], knowledge: [] as {id: string; title: string; description: string}[], files: [],
    createTask: vi.fn(), runTask: vi.fn(), updateTask: vi.fn(), stopTask: vi.fn(), deleteTask: vi.fn(),
    refreshTasks: vi.fn(),
  },
  api: {
    getTeam: vi.fn(),
    uploadFile: vi.fn(),
    listIssues: vi.fn(),
    getIssue: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    commentOnIssue: vi.fn(),
    removeIssueAgent: vi.fn(),
    linkIssueThread: vi.fn(),
    addIssueParticipants: vi.fn(),
    discover: vi.fn(),
  },
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => mocks.ws }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ email: 'alice-id' }) }));
vi.mock('@/lib/api', () => ({ workspaceApi: mocks.api }));
vi.mock('@/components/layout/layout-context', () => ({
  useLayout: () => ({ openView: vi.fn() }),
}));
const t = (key: string, params?: Record<string, string | number>) => translate(messages, messages, 'en-US', key, params);
vi.mock('@/lib/i18n', () => ({
  useT: () => t,
  useI18n: () => ({ locale: 'en-US' }),
  useFormatters: () => ({ timeAgo: () => 'just now' }),
}));
vi.mock('@/components/layout/app-header', () => ({
  DetailHeader: ({
    title,
    children,
  }: {
    title: React.ReactNode;
    children: React.ReactNode;
  }) => createElement('header', {}, title, children),
}));
vi.mock('@/components/chat/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) =>
    createElement('div', {}, content),
}));
vi.mock('@/components/tasks/task-chat-popup', () => ({
  TaskChatPopup: () => null,
}));
vi.mock('@/components/ui/responsive-dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
  DialogBody: ({ children }: { children: React.ReactNode }) =>
    createElement('div', {}, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    createElement('div', {}, children),
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    createElement('div', {}, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    createElement('div', {}, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) => createElement('p', {}, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    createElement('h2', {}, children),
}));
import { IssuesView } from './issues-view';

const issue: IssueDetail = {
  id: 'issue-1',
  title: 'Improve onboarding',
  description: 'Discuss the first screen.',
  status: 'open',
  created_by: 'human:alice-id',
  created_by_name: 'Alice',
  created_at: '2026-10-07T12:00:00Z',
  updated_at: '2026-10-07T12:00:00Z',
  comments: [],
  threads: [],
  participants: [{ source: 'human:alice-id', name: 'Alice' }, { source: 'openagents:research-agent', name: 'Research agent' }],
};
let root: Root;
let host: HTMLDivElement;
const button = (text: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === text,
  )!;
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function fill(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function openIssue() {
  await act(async () => {
    root.render(createElement(IssuesView));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  await click(
    Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Improve onboarding'),
    )!,
  );
}

beforeEach(() => {
  mocks.ws.tasks = [];
  mocks.ws.knowledge = [];
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState(null, '', '/workspace-1?token=private-token');
  mocks.ws.agents = [];
  mocks.api.getTeam.mockResolvedValue([]);
  mocks.api.discover.mockResolvedValue({ agents: [] });
  mocks.api.addIssueParticipants.mockResolvedValue(undefined);
  mocks.api.listIssues.mockResolvedValue({
    issues: [issue],
    next_offset: null,
  });
  mocks.api.getIssue.mockResolvedValue(issue);
  mocks.api.createIssue.mockResolvedValue(issue);
  mocks.api.commentOnIssue.mockResolvedValue({ id: 'comment-1' });
  mocks.api.removeIssueAgent.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('shared issues', () => {
  it('creates an issue without agents or an execution request', async () => {
    mocks.api.listIssues.mockResolvedValue({ issues: [], next_offset: null });
    await act(async () => root.render(createElement(IssuesView)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await click(button('New issue'));
    await fill(host.querySelector('input[required]')!, 'Improve onboarding');
    await click(button('Create issue'));
    expect(mocks.api.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Improve onboarding',
        source: 'human:alice-id',
        source_name: 'Alice',
      }),
    );

    expect(host.textContent).toContain('Add to the discussion');
    expect(window.location.pathname).toBe('/workspace-1/issues/issue-1');
    expect(window.location.search).not.toContain('issue=');
  });

  it('keeps discussion passive and retains the draft on a failed comment', async () => {
    await openIssue();
    const textarea = host.querySelector('textarea')!;
    await fill(textarea, '@agent-alpha Please consider this idea.');
    mocks.api.commentOnIssue.mockRejectedValueOnce(
      new Error('Connection interrupted'),
    );
    await click(button('Comment'));
    expect(textarea.value).toBe('@agent-alpha Please consider this idea.');
    expect(host.textContent).toContain('Connection interrupted');
    await click(button('Comment'));
    expect(textarea.value).toBe('');

  });

  it('does not reset edits when a collaborator update is polled', async () => {
    await openIssue();
    await click(button('Edit'));
    const title = host.querySelector('input[required]')! as HTMLInputElement;
    await fill(title, 'My unsaved title');
    mocks.api.getIssue.mockResolvedValue({
      ...issue,
      description: 'Updated remotely',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(title.value).toBe('My unsaved title');
  });

  it('selects a human and an offline agent by keyboard and saves their identities', async () => {
    mocks.api.getTeam.mockResolvedValue([
      { email: 'bob@example.com', displayName: 'Bob', role: 'member' },
    ]);
    mocks.ws.agents = [
      {
        agentName: 'research-agent',
        displayName: 'Research agent',
        status: 'offline',
      },
    ];
    await openIssue();
    const input = host.querySelector('textarea')!;
    await fill(input, 'Ask @Bo');
    expect(host.querySelector('[role=option]')?.textContent).toContain('Bob');
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(input.value).toBe('Ask @Bob ');
    expect(mocks.api.commentOnIssue).not.toHaveBeenCalled();
    await fill(input, input.value + 'and @Res');
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(input.value).toBe('Ask @Bob and @Research agent ');
    await click(button('Comment'));
    expect(mocks.api.commentOnIssue).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({
        content: 'Ask @bob@example.com and @research-agent ',
      }),
    );

  });

  it('dismisses mention suggestions with Escape without losing the draft', async () => {
    await openIssue();
    const input = host.querySelector('textarea')!;
    await fill(input, 'Hello @');
    expect(host.querySelector('[role=listbox]')).not.toBeNull();
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(host.querySelector('[role=listbox]')).toBeNull();
    expect(input.value).toBe('Hello @');
  });

  it('removes an agent from the issue and has no start-work button', async () => {
    await openIssue();
    expect(host.textContent).not.toContain('Start agent work');
    await click(host.querySelector('[aria-label="Remove Research agent from issue"]')!);
    expect(mocks.api.removeIssueAgent).toHaveBeenCalledWith('issue-1', 'research-agent');
  });

  it('clears a temporary loading error when polling recovers', async () => {
    window.history.replaceState(null, '', '/workspace-1?issue=issue-1');
    mocks.api.getIssue.mockRejectedValueOnce(new Error('Temporarily offline'));
    await act(async () => root.render(createElement(IssuesView)));
    expect(host.textContent).toContain('Temporarily offline');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(host.textContent).not.toContain('Temporarily offline');
    expect(host.textContent).toContain('Discuss the first screen.');
  });

  it('opens a directly linked issue', async () => {
    window.history.replaceState(null, '', '/workspace-1?issue=issue-1');
    await act(async () => root.render(createElement(IssuesView)));
    expect(mocks.api.getIssue).toHaveBeenCalledWith('issue-1');
    expect(host.textContent).toContain('Discuss the first screen.');
  });
});

it('adds people and agents without starting work, and omits the issue Tasks section', async () => {
  mocks.api.getTeam.mockResolvedValue([{ email: 'bob@example.com', displayName: 'Bob', role: 'member' }]);
  mocks.api.discover.mockResolvedValue({ agents: [{ address: 'openagents:new-agent', display_name: 'New agent', status: 'online' }, { address: 'openagents:offline-agent', status: 'offline' }] });
  await openIssue();
  expect(host.textContent).not.toContain('Break out a task');
  await click(button('Add people or agents'));
  const dialog = host.querySelector('[role=dialog]')!;
  await click(Array.from(dialog.querySelectorAll<HTMLElement>('[role=checkbox]')).find((b) => b.textContent?.includes('Bob'))!);
  await click(Array.from(dialog.querySelectorAll<HTMLElement>('[role=checkbox]')).find((b) => b.textContent?.includes('New agent'))!);
  await click(button('Add to issue'));
  expect(mocks.api.addIssueParticipants).toHaveBeenCalledWith('issue-1', [
    expect.objectContaining({ kind: 'human', id: 'bob@example.com' }),
    expect.objectContaining({ kind: 'agent', id: 'new-agent' }),
  ]);

});

it('clears a saved comment and reports delivery failure without inviting a duplicate submission', async () => {
  await openIssue();
  mocks.api.commentOnIssue.mockResolvedValueOnce({ id: 'saved', dispatch_error: 'Comment saved; delivery failed' });
  await fill(host.querySelector('textarea')!, '@research-agent investigate');
  await click(button('Comment'));
  expect(host.querySelector('textarea')!.value).toBe('');
  expect(host.textContent).toContain('Comment saved; delivery failed');
});

it.each(['metaKey', 'ctrlKey'] as const)('sends an issue comment with %s + Enter, but not plain Enter or IME confirmation', async (modifier) => {
  await openIssue();
  const textarea = host.querySelector('textarea')!;
  await fill(textarea, 'Please review this');
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mocks.api.commentOnIssue).not.toHaveBeenCalled();
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', [modifier]: true, isComposing: true, bubbles: true })); });
  expect(mocks.api.commentOnIssue).not.toHaveBeenCalled();
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', [modifier]: true, bubbles: true })); });
  expect(mocks.api.commentOnIssue).toHaveBeenCalledTimes(1);
  expect(mocks.api.commentOnIssue).toHaveBeenCalledWith('issue-1', expect.objectContaining({ content: 'Please review this' }));
  expect(textarea.value).toBe('');
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', [modifier]: true, bubbles: true })); });
  expect(mocks.api.commentOnIssue).toHaveBeenCalledTimes(1);
});

it('saves labels and paused status in issue details', async () => {
  await openIssue();
  const status = host.querySelector('select[id^="issue-status-"]') as HTMLSelectElement;
  expect([...status.options].some(option => option.value === 'paused')).toBe(true);
  await act(async () => { status.value = 'paused'; status.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(mocks.api.updateIssue).toHaveBeenCalledWith('issue-1', expect.objectContaining({ status: 'paused' }));
  await click(host.querySelector<HTMLButtonElement>('button[aria-label="Add a label"]')!);
  const input = host.querySelector('input[id^="issue-label-"]') as HTMLInputElement;
  await fill(input, 'Bug');
  await act(async () => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.api.updateIssue).toHaveBeenCalledWith('issue-1', expect.objectContaining({ labels: ['Bug'] }));
});

it('searches the assignee picker and saves a selected person', async () => {
  mocks.api.getTeam.mockResolvedValue([{ email: 'bob@example.com', displayName: 'Bob', role: 'member' }]);
  await openIssue();
  await click(host.querySelector<HTMLButtonElement>('button[aria-labelledby="issue-assignee-issue-1"]')!);
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search people or your agents…"]')!;
  expect(search).not.toBeNull();
  await fill(search, 'Bob');
  const choice = Array.from(document.querySelectorAll('button')).find(item => item.textContent === 'Bob')!;
  await click(choice);
  expect(mocks.api.updateIssue).toHaveBeenCalledWith('issue-1', expect.objectContaining({ assignee: 'human:bob@example.com' }));
  expect(document.querySelector('input[aria-label="Search people or your agents…"]')).toBeNull();
});


it('prepares work within the issue without starting it', async () => {
  mocks.ws.createTask.mockResolvedValue({ id: 'run-1' });
  await openIssue();
  await click(button('Add agent work'));
  const dialog = host.querySelector('[role="dialog"]')!;
  await fill(dialog.querySelector('textarea')!, 'Investigate the drop');
  await click(Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Create')!);
  expect(mocks.ws.createTask).toHaveBeenCalledWith(expect.objectContaining({ issueId: issue.id, title: issue.title, description: 'Investigate the drop', status: 'backlog' }));
  expect(mocks.ws.runTask).not.toHaveBeenCalled();
});

it('runs linked work without changing the issue status', async () => {
  mocks.ws.tasks = [{ id: 'run-1', issueId: issue.id, title: 'Investigate', description: '', status: 'backlog', assignee: 'research-agent', knowledgeIds: [], fileIds: [], channelName: null } as unknown as KanbanTask];
  mocks.ws.runTask.mockResolvedValue(undefined);
  await openIssue();
  await click(button('Run'));
  expect(mocks.ws.runTask).toHaveBeenCalledWith('run-1');
  expect(mocks.api.updateIssue).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Completing a run does not close the issue');
});

it('keeps existing standalone work reachable inside Issues', async () => {
  mocks.ws.tasks = [{ id: 'old-task', issueId: null, title: 'Existing task', description: '', status: 'need_input', assignee: 'research-agent', knowledgeIds: [], fileIds: [], channelName: 'task:old-task' } as unknown as KanbanTask];
  await act(async () => root.render(createElement(IssuesView, { initialWork: true })));
  expect(host.textContent).toContain('Existing task');
  expect(host.textContent).toContain('New issue');
  expect(host.textContent).not.toContain('New task');
});


it('keeps the work draft when preparing a run fails', async () => {
  mocks.ws.createTask.mockRejectedValueOnce(new Error('Could not save work'));
  await openIssue();
  await click(button('Add agent work'));
  const dialog = host.querySelector('[role="dialog"]')!;
  await fill(dialog.querySelector('textarea')!, 'Keep my investigation notes');
  await click(Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Create')!);
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(dialog.querySelector('textarea')!.value).toBe('Keep my investigation notes');
  expect(dialog.textContent).toContain('Could not save work');
});

it('creates assigned agent work with knowledge and waits for attachments to upload', async () => {
  mocks.ws.agents = [{ agentName: 'research-agent', displayName: 'Research agent', ownerEmail: 'alice-id', status: 'offline' },
    { agentName: 'other-agent', displayName: 'Other agent', ownerEmail: 'someone-else', status: 'online' }];
  mocks.ws.knowledge = [{ id: 'guide-1', title: 'Support guide', description: 'Reference notes' }];
  mocks.api.listIssues.mockResolvedValue({ issues: [], next_offset: null });
  await act(async () => root.render(createElement(IssuesView)));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  await click(button('New issue'));
  await fill(host.querySelector('input[required]')!, 'Review evidence');
  await click(host.querySelector('button[aria-label="Assignee"]')!);
  expect(document.querySelector('[cmdk-list]')?.textContent).not.toContain('Other agent');
  expect(host.textContent).not.toContain('Support guide');
  expect(document.querySelector('[cmdk-list]')?.textContent).toContain('Your agents');
  const search = document.querySelector('input[cmdk-input]')! as HTMLInputElement;
  await fill(search, 'Research');
  await click(document.querySelector('[cmdk-item][data-value="openagents:research-agent"]')!);
  await click(Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Support guide'))!);
  let finish!: (value: unknown) => void;
  mocks.api.uploadFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const input = host.querySelector('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [new File(['evidence'], 'evidence.txt', { type: 'text/plain' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(button('Create issue').disabled).toBe(true);
  expect(mocks.api.createIssue).not.toHaveBeenCalled();
  await act(async () => finish({ id: 'file-1', filename: 'evidence.txt', contentType: 'text/plain' }));
  mocks.api.createIssue.mockRejectedValueOnce(new Error('Try again'));
  await click(button('Create issue'));
  expect(host.textContent).toContain('Try again');
  expect(host.textContent).toContain('evidence.txt');
  await click(button('Create issue'));
  expect(mocks.api.createIssue).toHaveBeenLastCalledWith(expect.objectContaining({
    assignee: 'openagents:research-agent', knowledge_ids: ['guide-1'], file_ids: ['file-1'],
  }));
  expect(mocks.ws.runTask).not.toHaveBeenCalled();
});

it('shows saved attachments and knowledge as links on the issue', async () => {
  mocks.api.getIssue.mockResolvedValue({ ...issue,
    attachments: [{ file_id: 'file-1', filename: 'evidence.txt', content_type: 'text/plain', size: 8 }],
    knowledge: [{ id: 'guide-1', title: 'Support guide' }],
  });
  await openIssue();
  expect(host.querySelector('a[href="/workspace-1/files/file-1"]')?.textContent).toBe('evidence.txt');
  expect(host.querySelector('a[href="/workspace-1/knowledge/guide-1"]')?.textContent).toBe('Support guide');
});

it('requires an agent assignment when creating from Agent work and supports keyboard selection', async () => {
  mocks.ws.agents = [{ agentName: 'research-agent', displayName: 'Research agent', ownerEmail: 'alice-id', status: 'offline' }];
  await act(async () => root.render(createElement(IssuesView, { initialWork: true })));
  await click(button('New issue'));
  await fill(host.querySelector('input[required]')!, 'Agent investigation');
  expect(button('Create issue').disabled).toBe(true);
  await click(host.querySelector('button[aria-label="Assignee"]')!);
  const list = document.querySelector('[cmdk-list]')!;
  expect(list.textContent).toContain('Your agents');
  expect(list.textContent).not.toContain('Alice');
  expect(list.textContent).not.toContain('Unassigned');
  const search = document.querySelector('input[cmdk-input]')! as HTMLInputElement;
  await fill(search, 'Research');
  await act(async () => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  expect(document.querySelector('[cmdk-list]')).toBeNull();
  expect(mocks.api.createIssue).not.toHaveBeenCalled();
  expect(button('Create issue').disabled).toBe(false);
  await click(button('Create issue'));
  expect(mocks.api.createIssue).toHaveBeenCalledWith(expect.objectContaining({ assignee: 'openagents:research-agent' }));
});

it('requests assignments to the signed-in user across search, pagination, and board view', async () => {
  await act(async () => root.render(createElement(IssuesView)));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  mocks.api.listIssues.mockResolvedValue({ issues: [issue], next_offset: 100 });
  await click(button('Assigned to me'));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(mocks.api.listIssues).toHaveBeenLastCalledWith(expect.objectContaining({ assignedToMe: true, status: undefined, offset: 0 }));
  await click(button('Load more'));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(mocks.api.listIssues).toHaveBeenLastCalledWith(expect.objectContaining({ assignedToMe: true, offset: 100 }));
  await fill(host.querySelector('input[aria-label="Search issues"]')!, 'follow-up');
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(mocks.api.listIssues).toHaveBeenLastCalledWith(expect.objectContaining({ assignedToMe: true, query: 'follow-up', offset: 0 }));
  await click(host.querySelector('button[aria-label="Board view"]')!);
  expect(host.textContent).toContain('Improve onboarding');
  await click(button('All issues'));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(mocks.api.listIssues).toHaveBeenLastCalledWith(expect.objectContaining({ assignedToMe: false, offset: 0 }));
});

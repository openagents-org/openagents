// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { IssueDetail } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  ws: {
    workspace: { workspaceId: 'workspace-1' },
    currentUser: { id: 'alice-id', name: 'Alice' },
    agents: [] as unknown[],
    sessions: [],
    tasks: [],
    refreshTasks: vi.fn(),
  },
  api: {
    getTeam: vi.fn(),
    listIssues: vi.fn(),
    getIssue: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    commentOnIssue: vi.fn(),
    startIssueThread: vi.fn(),
    linkIssueThread: vi.fn(),
    addIssueTask: vi.fn(),
  },
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => mocks.ws }));
vi.mock('@/lib/api', () => ({ workspaceApi: mocks.api }));
vi.mock('@/components/layout/layout-context', () => ({
  useLayout: () => ({ openView: vi.fn() }),
}));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    translate(messages, messages, 'en-US', key, params),
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
  tasks: [],
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
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, '', '/workspace-1?token=private-token');
  mocks.ws.agents = [];
  mocks.api.getTeam.mockResolvedValue([]);
  mocks.api.listIssues.mockResolvedValue({
    issues: [issue],
    next_offset: null,
  });
  mocks.api.getIssue.mockResolvedValue(issue);
  mocks.api.createIssue.mockResolvedValue(issue);
  mocks.api.commentOnIssue.mockResolvedValue({ id: 'comment-1' });
  mocks.api.startIssueThread.mockResolvedValue({ channel_name: 'work-1' });
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
    expect(mocks.api.startIssueThread).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Add to the discussion');
    expect(window.location.search).toContain('issue=issue-1');
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
    expect(mocks.api.startIssueThread).not.toHaveBeenCalled();
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
    expect(input.value).toBe('Ask @bob@example.com ');
    expect(mocks.api.commentOnIssue).not.toHaveBeenCalled();
    await fill(input, input.value + 'and @Res');
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(input.value).toBe('Ask @bob@example.com and @research-agent ');
    await click(button('Comment'));
    expect(mocks.api.commentOnIssue).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({
        content: 'Ask @bob@example.com and @research-agent ',
      }),
    );
    expect(mocks.api.startIssueThread).not.toHaveBeenCalled();
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

  it('only starts agents after choosing an agent and submitting an instruction', async () => {
    mocks.ws.agents = [
      {
        agentName: 'research-agent',
        displayName: 'Research agent',
        status: 'online',
      },
    ];
    await openIssue();
    await click(button('Bring in an agent'));
    expect(mocks.api.startIssueThread).not.toHaveBeenCalled();
    await click(host.querySelector('input[type=checkbox]')!);
    await fill(
      host.querySelector('[role=dialog] textarea')!,
      'Investigate the first screen',
    );
    await click(button('Start agent work'));
    expect(mocks.api.startIssueThread).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({
        agents: ['research-agent'],
        instruction: 'Investigate the first screen',
        source_name: 'Alice',
      }),
    );
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

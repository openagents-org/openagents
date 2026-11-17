import { describe, expect, it } from 'vitest';
import { filtersShowingIssue, type IssueListFilters } from './issue-jump';

const base: IssueListFilters = { status: 'all', query: '', assignee: '' };
const issue = { status: 'open' as const, assignee: null, title: 'Fix login', description: 'Users get logged out' };
const me = 'me@acme.test';

describe('filtersShowingIssue', () => {
  it('keeps "Active issues" for an open or in-progress issue', () => {
    expect(filtersShowingIssue(base, issue, me)).toEqual(base);
    expect(filtersShowingIssue(base, { ...issue, status: 'in_progress' }, me)).toEqual(base);
  });

  it('moves a paused or closed issue to its own status tab', () => {
    expect(filtersShowingIssue(base, { ...issue, status: 'closed' }, me).status).toBe('closed');
    expect(filtersShowingIssue(base, { ...issue, status: 'paused' }, me).status).toBe('paused');
  });

  it('keeps a status tab that already lists the issue', () => {
    const closedTab = { ...base, status: 'closed' as const };
    expect(filtersShowingIssue(closedTab, { ...issue, status: 'closed' }, me)).toEqual(closedTab);
  });

  it('sends a hidden active issue back to "Active issues"', () => {
    expect(filtersShowingIssue({ ...base, status: 'closed' }, issue, me).status).toBe('all');
    expect(filtersShowingIssue({ ...base, status: 'paused' }, { ...issue, status: 'in_progress' }, me).status).toBe('all');
  });

  it('keeps "Assigned to me" only for an active issue assigned to the viewer', () => {
    const mine = { ...base, status: 'mine' as const };
    expect(filtersShowingIssue(mine, { ...issue, assignee: 'human:Me@Acme.test' }, me).status).toBe('mine');
    expect(filtersShowingIssue(mine, issue, me).status).toBe('all');
    expect(filtersShowingIssue(mine, { ...issue, status: 'closed', assignee: `human:${me}` }, me).status).toBe('closed');
  });

  it('clears an assignee filter or search that hides the issue, and keeps one that does not', () => {
    expect(filtersShowingIssue({ ...base, assignee: 'openagents:scout' }, issue, me).assignee).toBe('');
    expect(filtersShowingIssue({ ...base, assignee: 'none' }, issue, me).assignee).toBe('none');
    expect(filtersShowingIssue({ ...base, assignee: 'none' }, { ...issue, assignee: 'openagents:scout' }, me).assignee).toBe('');
    expect(filtersShowingIssue({ ...base, query: 'billing' }, issue, me).query).toBe('');
    expect(filtersShowingIssue({ ...base, query: 'LOGGED' }, issue, me).query).toBe('LOGGED');
  });
});

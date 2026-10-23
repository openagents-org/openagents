// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ApprovalsSettingsPage from '@/app/[workspaceId]/settings/approvals/page';
import { workspaceApi } from '@/lib/api';

const state = vi.hoisted(() => ({ editable: true }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgoShort: () => 'now' }) }));
vi.mock('@/components/settings/admin-context', () => ({
  useAdminSettings: () => ({ workspaceId: 'workspace', workspace: { requireLogin: true }, me: { role: state.editable ? 'admin' : 'member', email: 'admin@example.com' }, query: '' }),
  canAdminister: () => state.editable,
}));
vi.mock('@/lib/api', () => ({ workspaceApi: { listApprovals: vi.fn(), getApprovalPolicy: vi.fn(), updateApprovalPolicy: vi.fn(), getTeam: vi.fn(), resolveApproval: vi.fn() } }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
const policy = { rules: [], scope: '*', workspaceRules: [], channelRules: [], policies: [] } as Awaited<ReturnType<typeof workspaceApi.getApprovalPolicy>>;
beforeEach(() => {
  vi.clearAllMocks(); state.editable = true;
  vi.mocked(workspaceApi.getTeam).mockResolvedValue([
    { email: 'sam@example.com', displayName: 'Sam', role: 'member', avatarUrl: null, joinedAt: null },
    { email: 'viewer@example.com', displayName: 'Viewer', role: 'viewer', avatarUrl: null, joinedAt: null },
  ]);
  vi.mocked(workspaceApi.listApprovals).mockResolvedValue({ approvals: [], pendingByAgent: {} } as Awaited<ReturnType<typeof workspaceApi.listApprovals>>);
  vi.mocked(workspaceApi.getApprovalPolicy).mockResolvedValue(policy);
  vi.mocked(workspaceApi.updateApprovalPolicy).mockImplementation(async (rules) => ({ ...policy, rules: rules.map((r) => ({ ...r, label: r.description || r.kind, source: 'workspace' })) }) as Awaited<ReturnType<typeof workspaceApi.updateApprovalPolicy>>);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function render(openPolicy = true) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(ApprovalsSettingsPage)));
  if (openPolicy) await act(async () => (document.querySelector('[role="tab"][id$="policy"]') as HTMLButtonElement).focus());
}
function button(text: string) {
  const b = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!b) throw new Error(`Missing ${text}`);
  return b;
}
it('adds a template, edits the requirement, saves and removes it', async () => {
  await render();
  await act(async () => button('approvals.template.production.title').click());
  expect(document.querySelector('textarea')?.value).toBe('approvals.template.production.description');
  const select = document.querySelector('select[id$="-policy"]') as HTMLSelectElement;
  await act(async () => { select.value = 'owner'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button('common.save').click());
  const saved = vi.mocked(workspaceApi.updateApprovalPolicy).mock.calls[0][0];
  expect(saved).toEqual(expect.arrayContaining([expect.objectContaining({ description: 'approvals.template.production.description', policy: 'owner' })]));
  expect(button('common.save').disabled).toBe(true);
  await act(async () => (document.querySelector('[aria-label="approvals.removePolicy"]') as HTMLButtonElement).click());
  await act(async () => button('common.save').click());
  expect(vi.mocked(workspaceApi.updateApprovalPolicy).mock.calls[1][0]).toEqual([]);
});
it('does not save blank conditions or discard a draft after a save failure', async () => {
  await render();
  await act(async () => button('approvals.addPolicy').click());
  expect(button('common.save').disabled).toBe(true);
  await act(async () => button('approvals.template.sensitive.title').click());
  await act(async () => (document.querySelector('[aria-label="approvals.removePolicy"]') as HTMLButtonElement).click());
  vi.mocked(workspaceApi.updateApprovalPolicy).mockRejectedValueOnce(new Error('offline'));
  await act(async () => button('common.save').click());
  expect(document.querySelector('textarea')?.value).toBe('approvals.template.sensitive.description');
  expect(button('common.save').disabled).toBe(false);
});
it('disables all policy editing for members', async () => {
  state.editable = false;
  await render();
  expect(button('approvals.addPolicy').disabled).toBe(true);
  expect(button('approvals.template.production.title').disabled).toBe(true);
  expect(document.body.textContent).not.toContain('common.save');
});
it('shows only saved policies and no default table or reset button', async () => {
  const custom = { kind: 'custom:test', description: 'Production changes', policy: 'owner', source: 'workspace', label: 'Production changes' } as const;
  vi.mocked(workspaceApi.getApprovalPolicy).mockResolvedValue({ ...policy, rules: [custom] });
  await render();
  expect(document.querySelectorAll('textarea')).toHaveLength(1);
  expect(document.querySelector('textarea')?.value).toBe(custom.description);
  expect(document.querySelector('table')).toBeNull();
  expect(document.body.textContent).not.toContain('approvals.reset');
  expect(button('common.save').disabled).toBe(true);
});
it('does not enable editing when loading policies fails', async () => {
  vi.mocked(workspaceApi.getApprovalPolicy).mockRejectedValueOnce(new Error('offline'));
  await render();
  expect(button('approvals.addPolicy').disabled).toBe(true);
  expect(document.body.textContent).toContain('admin.loadFailed');
});

it('selects a specific member and preserves the choice through saving and tab switches', async () => {
  await render();
  await act(async () => button('approvals.addPolicy').click());
  const textarea = document.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Deploy production');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const select = document.querySelector('select[id$="-policy"]') as HTMLSelectElement;
    select.value = 'member'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(button('common.save').disabled).toBe(true);
  const member = document.querySelector('select[id$="-member"]') as HTMLSelectElement;
  expect(member.textContent).toContain('Sam');
  expect(member.textContent).not.toContain('Viewer');
  await act(async () => { member.value = 'sam@example.com'; member.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => (document.querySelector('[role="tab"][id$="pending"]') as HTMLButtonElement).focus());
  expect(document.querySelector('textarea')).toBeNull();
  await act(async () => (document.querySelector('[role="tab"][id$="policy"]') as HTMLButtonElement).focus());
  expect((document.querySelector('select[id$="-member"]') as HTMLSelectElement).value).toBe('sam@example.com');
  await act(async () => button('common.save').click());
  expect(workspaceApi.updateApprovalPolicy).toHaveBeenCalledWith([expect.objectContaining({ policy: 'member', approver_email: 'sam@example.com' })]);
});
it('opens the policy tab first and shows the advisory warning', async () => {
  await render(false);
  expect(document.querySelector('[role="tab"][aria-selected="true"]')).toBe(document.querySelector('[role="tab"]'));
  expect(document.querySelector('[role="tab"]')?.textContent).toBe('approvals.policyTitle');
  expect(document.querySelector('[role="note"]')?.textContent).toContain('approvals.advisoryWarning');
  expect(document.querySelector('textarea')).toBeNull();
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
});

it('keeps a partially approved request in the pending tab', async () => {
  const approval = { id: 'request', kind: 'deploy', kindClass: 'approval', status: 'pending', action: 'Deploy app', requiredRole: 'any', policyRequirements: { members: ['admin@example.com', 'sam@example.com'], approved_by: [], role_required: null, role_approved: false } } as unknown as import('@/lib/types').ApprovalRequest;
  vi.mocked(workspaceApi.listApprovals).mockResolvedValue({ approvals: [approval], pendingByAgent: {} });
  vi.mocked(workspaceApi.resolveApproval).mockResolvedValue({ ...approval, policyRequirements: { ...approval.policyRequirements!, approved_by: ['admin@example.com'] } });
  await render(false);
  await act(async () => (document.querySelector('[role="tab"][id$="pending"]') as HTMLButtonElement).focus());
  await act(async () => button('approvals.approve').click());
  expect(document.body.textContent).toContain('Deploy app');
  expect(document.body.textContent).toContain('approvals.reviewedBy');
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('1');
});

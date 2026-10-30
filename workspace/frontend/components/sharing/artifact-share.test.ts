// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ t: (key: string) => key, list: vi.fn(async () => []), create: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useT: () => mocks.t, useFormatters: () => ({ formatDate: () => '' }) }));
vi.mock('@/lib/api', () => ({ workspaceApi: { listGrants: mocks.list, createGrant: mocks.create } }));
vi.mock('./grantee-picker', () => ({ GranteePicker: () => React.createElement('div', null, 'Grant picker') }));
import { ArtifactShareContent } from './artifact-share';
it('explains read-only access instead of offering a share operation the server will reject', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(ArtifactShareContent, { kind: 'file', id: 'file', name: 'Other person’s file', visibility: 'public', canManage: false })));
    expect(host.textContent).toContain('artifactAccess.ownerMustShare');
    expect(host.textContent).not.toContain('Grant picker');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

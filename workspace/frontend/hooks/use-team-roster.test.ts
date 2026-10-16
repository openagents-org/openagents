// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

const getTeam = vi.fn(async () => [{ email: 'me@example.com', displayName: 'Ashin', avatarUrl: null, role: 'owner', joinedAt: null }]);
vi.mock('@/lib/api', () => ({ workspaceApi: { getTeam: () => getTeam() } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ workspace: null }) }));

it('re-reads the roster after a profile save, even with no view listening', async () => {
  const { loadTeamRoster } = await import('./use-team-roster');
  await loadTeamRoster('ws');
  await loadTeamRoster('ws');
  expect(getTeam).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('workspace-profile-updated'));
  await loadTeamRoster('ws');
  expect(getTeam).toHaveBeenCalledTimes(2);
});

import type { AccountWorkspace } from './account-api';
import { rememberWorkspaceToken } from './workspace-snapshot';

// Single-workspace users go straight in, once per browser session: going back
// to the home page on purpose still shows the list (rename/delete/create live
// there). Shared by the home page and the sign-in callback, which enters the
// workspace directly instead of stopping at the home page first.

const AUTO_ENTERED_KEY = 'oa_auto_entered_first_ws';

/** The lone owned workspace (the one auto-provisioned at sign-up) to enter, if any. */
export function autoEnterTarget(workspaces: AccountWorkspace[]): AccountWorkspace | null {
  if (workspaces.length !== 1 || workspaces[0].role !== 'owner') return null;
  if (typeof window === 'undefined' || sessionStorage.getItem(AUTO_ENTERED_KEY) === '1') return null;
  return workspaces[0];
}

export function markAutoEntered(): void {
  sessionStorage.setItem(AUTO_ENTERED_KEY, '1');
}

/**
 * Hand the tokens in a fresh workspace list to the workspace page, so opening
 * one of them right after does not wait on the same list being fetched again.
 * The workspace page still re-checks in the background.
 */
export function rememberWorkspaceTokens(workspaces: AccountWorkspace[], idToken: string): void {
  // Members and viewers get no token (null); the workspace page opens those on
  // an empty token plus the bearer, which is what it does after its own lookup.
  for (const w of workspaces) rememberWorkspaceToken(w.slug || w.workspaceId, idToken, w.token || '');
}

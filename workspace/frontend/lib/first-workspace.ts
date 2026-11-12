import type { AccountWorkspace } from './account-api';
import { rememberWorkspaceToken } from './workspace-snapshot';

// Where a signed-in user lands without picking a workspace, and why. Shared by
// the home page and the sign-in callback, which enters the workspace directly
// instead of stopping at the home page first. Once per browser session, so
// going back to the home page on purpose still shows the list (rename/delete/
// create live there).

const AUTO_ENTERED_KEY = 'oa_auto_entered_first_ws';
const LANDING_NOTE_KEY = 'oa_landing_note';

/**
 * - created: we just made this workspace for them (first sign-in).
 * - only: it is their one workspace.
 * - invited: a workspace they were invited to, picked over the empty one we
 *   created for them, which they never asked for.
 */
export type LandingReason = 'created' | 'only' | 'invited';

export interface LandingTarget {
  workspace: AccountWorkspace;
  reason: LandingReason;
}

export function landingTarget(workspaces: AccountWorkspace[]): LandingTarget | null {
  if (typeof window === 'undefined' || sessionStorage.getItem(AUTO_ENTERED_KEY) === '1') return null;
  const owned = workspaces.filter((w) => w.role === 'owner');
  const invited = workspaces.filter((w) => w.role !== 'owner');
  if (invited.length === 1 && owned.length > 0 && owned.every((w) => w.autoProvisioned && w.untouched === true)) {
    return { workspace: invited[0], reason: 'invited' };
  }
  if (workspaces.length === 1 && owned.length === 1) {
    return { workspace: owned[0], reason: owned[0].justCreated ? 'created' : 'only' };
  }
  return null;
}

/** The workspace to enter without asking, if any. */
export function autoEnterTarget(workspaces: AccountWorkspace[]): AccountWorkspace | null {
  return landingTarget(workspaces)?.workspace ?? null;
}

/** Record the auto-entry, and leave the workspace a note saying why it opened. */
export function markAutoEntered(target?: LandingTarget): void {
  sessionStorage.setItem(AUTO_ENTERED_KEY, '1');
  if (!target) return;
  try {
    sessionStorage.setItem(LANDING_NOTE_KEY, JSON.stringify({
      slug: target.workspace.slug, workspaceId: target.workspace.workspaceId,
      name: target.workspace.name, reason: target.reason,
    }));
  } catch { /* no note, the workspace still opens */ }
}

export interface LandingNote {
  slug: string;
  workspaceId: string;
  name: string;
  reason: LandingReason;
}

/** The note for this workspace, read once. */
export function takeLandingNote(slugOrId: string): LandingNote | null {
  try {
    const raw = sessionStorage.getItem(LANDING_NOTE_KEY);
    if (!raw) return null;
    const note = JSON.parse(raw) as LandingNote;
    if (note.slug !== slugOrId && note.workspaceId !== slugOrId) return null;
    sessionStorage.removeItem(LANDING_NOTE_KEY);
    return note;
  } catch {
    return null;
  }
}

/** Workspaces the user was invited to before an untouched one we created for them. */
export function orderWorkspaces(workspaces: AccountWorkspace[]): AccountWorkspace[] {
  const unused = (w: AccountWorkspace) => !!w.autoProvisioned && w.untouched === true;
  return [...workspaces.filter((w) => !unused(w)), ...workspaces.filter(unused)];
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

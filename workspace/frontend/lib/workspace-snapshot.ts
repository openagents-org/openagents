import type { workspaceApi } from './api';
import type { Workspace } from './types';

/**
 * In-memory copies of what a workspace last opened with, so coming back to it
 * (from Settings, for instance) paints at once instead of behind the
 * full-screen loader while the same data is fetched again.
 *
 * Module state on purpose: moving between the workspace and its settings is a
 * client-side navigation, so this survives it, while a reload or a new tab
 * starts empty and loads normally. Whatever is served from here is always
 * refreshed in the background straight after.
 */

type Discovery = Awaited<ReturnType<typeof workspaceApi.discover>>;

export interface WorkspaceSnapshot {
  workspace: Workspace;
  discovery: Discovery;
}

/** Older than this, the loader is the more honest thing to show. */
const MAX_AGE_MS = 10 * 60 * 1000;

const snapshots = new Map<string, WorkspaceSnapshot & { at: number }>();
const tokens = new Map<string, string>();

/** One key per set of credentials: another token may see another roster. */
export function snapshotKey(workspaceId: string, token: string, bearerToken?: string): string {
  return `${workspaceId}\n${token}\n${bearerToken || ''}`;
}

export function readWorkspaceSnapshot(key: string): WorkspaceSnapshot | null {
  const hit = snapshots.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MAX_AGE_MS) {
    snapshots.delete(key);
    return null;
  }
  return hit;
}

export function writeWorkspaceSnapshot(key: string, snapshot: WorkspaceSnapshot): void {
  snapshots.set(key, { ...snapshot, at: Date.now() });
}

export function forgetWorkspaceSnapshot(key: string): void {
  snapshots.delete(key);
}

/** Tests only: start from a page that has opened nothing. */
export function clearWorkspaceSnapshots(): void {
  snapshots.clear();
  tokens.clear();
}

/** The workspace token last resolved for this workspace and account. */
export function recallWorkspaceToken(workspaceId: string, idToken: string): string | null {
  return tokens.get(`${workspaceId}\n${idToken}`) ?? null;
}

export function rememberWorkspaceToken(workspaceId: string, idToken: string, token: string): void {
  tokens.set(`${workspaceId}\n${idToken}`, token);
}

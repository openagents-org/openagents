/** Per-viewer, per-thread dismissal. No browser/session credentials are stored. */
export function browserPreviewPreferenceKey(workspace: string, viewer: string, thread: string): string {
  return `browser-preview-dismissed:${JSON.stringify([workspace, viewer, thread])}`;
}

export function browserPreviewDismissed(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

export function dismissBrowserPreview(key: string): void {
  try { localStorage.setItem(key, '1'); } catch { /* In-memory dismissal still works. */ }
}

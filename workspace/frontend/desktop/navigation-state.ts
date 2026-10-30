/** Only relative app routes are restored; credentials never enter preferences. */
export function restorableRoute(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://desktop.invalid');
    if (url.origin !== 'https://desktop.invalid' || url.hash) return null;
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.some(p => !/^[\w-]+$/.test(p)) || ['auth', 'share', 'invite'].includes(parts[0])) return null;
    if (parts.length > 1 && (parts[1] !== 'settings' || parts.length > 3)) return null;
    // Workspace membership resolves its access token on load. Never save tokens
    // or other query parameters from a shared link as navigation state.
    return url.pathname;
  } catch { return null; }
}

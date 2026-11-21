/** Save the existing credential on this host; the API still authorizes requests. */
export function setWorkspaceCookie(slug: string, token: string) {
  const hostname = window.location.hostname;
  const domain = hostname === 'openagents.org' || hostname.endsWith('.openagents.org')
    ? ';domain=.openagents.org' : '';
  const secure = window.location.protocol === 'https:' ? ';secure' : '';
  const shared = `path=/;max-age=${30 * 24 * 60 * 60};samesite=lax${secure}${domain}`;
  document.cookie = `oa_workspace=${encodeURIComponent(JSON.stringify({ slug, token }))};${shared}`;
  document.cookie = `oa_has_workspace=1;${shared}`;
}

/** Existing browser credential; the API remains responsible for authorization. */
export function readWorkspaceCookie(workspaceId?: string): { slug: string; token: string } | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('oa_workspace='));
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw.slice('oa_workspace='.length)));
    if (!value || typeof value.slug !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value.slug)
      || typeof value.token !== 'string' || !value.token.trim()
      || (workspaceId !== undefined && value.slug !== workspaceId)) return null;
    return { slug: value.slug, token: value.token };
  } catch { return null; }
}

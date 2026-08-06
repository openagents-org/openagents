// What the user pastes into "connect to workspace" is one of three things: a
// bare token, a link to the hosted workspace, or a link to a self-hosted one.
// Only a token means anything to the backend — a whole URL comes back as
// "Invalid or expired token" — so every entry point normalizes here first.

export const HOSTED_WORKSPACE_HOST = "workspace.openagents.org"

/**
 * The bare token inside a hosted workspace link. Accepts both the `?token=<t>`
 * form the workspace app puts in the address bar and the `/<t>` invite form.
 *
 * Returns null for a bare token (nothing to extract) and for self-hosted links,
 * which need their endpoint too — see `parseCustomWorkspaceUrl`.
 */
export function extractHostedWorkspaceToken(urlStr: string): string | null {
  const u = safeUrl(urlStr)
  if (!u || u.hostname.toLowerCase() !== HOSTED_WORKSPACE_HOST) return null
  const fromQuery = u.searchParams.get("token")
  if (fromQuery) return fromQuery.trim()
  const firstSegment = firstPathSegment(u)
  return firstSegment ?? null
}

/**
 * The workspace slug a hosted link points at — its first path segment. Only
 * meaningful when the link also carries `?token=`; without one, that segment is
 * the token (the invite form) and `extractHostedWorkspaceToken` returns it.
 */
export function hostedWorkspaceSlug(urlStr: string): string | undefined {
  const u = safeUrl(urlStr)
  if (!u || u.hostname.toLowerCase() !== HOSTED_WORKSPACE_HOST) return undefined
  return u.searchParams.get("token") ? firstPathSegment(u) : undefined
}

/** Endpoint + slug + token of a self-hosted workspace link; null if hosted. */
export function parseCustomWorkspaceUrl(
  urlStr: string,
): { endpoint: string; slug?: string; token?: string } | null {
  const u = safeUrl(urlStr)
  if (!u || u.hostname.toLowerCase() === HOSTED_WORKSPACE_HOST) return null
  return {
    endpoint: u.origin,
    slug: firstPathSegment(u),
    token: u.searchParams.get("token") || undefined,
  }
}

/**
 * True when the input was a link that carried no token at all — the slug is
 * then the only thing left to try, and a slug never resolves. Worth telling
 * apart: the user has to go copy the token, not retype the link.
 */
export function isLinkWithoutToken(urlStr: string): boolean {
  const u = safeUrl(urlStr)
  return !!u && !u.searchParams.get("token")
}

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL((raw || "").trim())
    return u.protocol === "http:" || u.protocol === "https:" ? u : null
  } catch {
    return null
  }
}

function firstPathSegment(u: URL): string | undefined {
  const segment = u.pathname.replace(/^\//, "").split("/")[0]
  return segment ? segment.trim() : undefined
}

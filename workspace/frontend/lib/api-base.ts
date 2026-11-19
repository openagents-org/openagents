const HOSTED_API = 'https://workspace-endpoint.openagents.org';

/** Preview CSP permits assets on the backend origin and ticket path. The web
 * API proxy changes both, so ticket-scoped frames must use the direct endpoint.
 * Creating the preview ticket still uses the normal authenticated transport.
 * A same-origin base (self-host, e.g. `/api`) stays relative: the backend is
 * this origin there.
 */
export function getProjectPreviewUrl(path: string, apiBase = getApiBaseUrl()): string {
  return (apiBase === '/wsapi' ? HOSTED_API : apiBase) + path;
}

/**
 * Keep API traffic direct so frequent browser polling bypasses the frontend CDN.
 *
 * NEXT_PUBLIC_API_URL may be absolute (`https://api.example.com`) or a
 * same-origin path (`/api`): a self-hosted reverse proxy serves the backend
 * under /api on the app's own origin, so one build works on any domain. A
 * relative base is only meaningful on a web origin; in the desktop renderer
 * (`openagents://workspace`) it is resolved against the launcher's web origin.
 */
export function getApiBaseUrl(configured = process.env.NEXT_PUBLIC_API_URL): string {
  const base = (configured || HOSTED_API).replace(/\/+$/, '');
  if (!base.startsWith('/') || typeof window === 'undefined') return base;
  const { protocol } = window.location ?? {};
  if (protocol === 'http:' || protocol === 'https:') return base;
  const webOrigin = (window as unknown as { __OA_WEB_URL__?: string }).__OA_WEB_URL__;
  return webOrigin ? webOrigin.replace(/\/+$/, '') + base : base;
}

/**
 * An API URL usable outside this page (stored in a message, handed to an
 * agent): a same-origin `/api/...` URL gets this origin. Absolute URLs pass
 * through unchanged.
 */
export function absoluteApiUrl(url: string): string {
  if (!url.startsWith('/') || url.startsWith('//') || typeof window === 'undefined') return url;
  const { protocol, origin } = window.location ?? {};
  return protocol === 'http:' || protocol === 'https:' ? origin + url : url;
}

/**
 * The CLI flag that points the agent connector at this instance, or '' on the
 * hosted service (the connector defaults to openagents.org). Self-hosted
 * instances must hand agents their own endpoint, e.g.
 * `agn device connect <code> --endpoint https://agents.example.com/api`.
 */
export function connectorEndpointFlag(apiBase = getApiBaseUrl()): string {
  if (!apiBase || apiBase === HOSTED_API || apiBase === '/wsapi') return '';
  let absolute = apiBase;
  if (apiBase.startsWith('/')) {
    if (typeof window === 'undefined' || !/^https?:$/.test(window.location?.protocol ?? '')) return '';
    absolute = window.location.origin + apiBase;
  }
  return ` --endpoint ${absolute}`;
}

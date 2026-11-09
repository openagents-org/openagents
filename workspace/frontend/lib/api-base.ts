const HOSTED_API = 'https://workspace-endpoint.openagents.org';

/** Preview CSP permits assets on the backend origin and ticket path. The web
 * API proxy changes both, so ticket-scoped frames must use the direct endpoint.
 * Creating the preview ticket still uses the normal authenticated transport.
 */
export function getProjectPreviewUrl(path: string, apiBase = getApiBaseUrl()): string {
  return (apiBase === '/wsapi' ? HOSTED_API : apiBase) + path;
}

/** Keep API traffic direct so frequent browser polling bypasses the frontend CDN. */
export function getApiBaseUrl(configured = process.env.NEXT_PUBLIC_API_URL): string {
  return (configured || HOSTED_API).replace(/\/+$/, '');
}

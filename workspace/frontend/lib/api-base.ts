import { desktopHost } from './desktop-host';

const HOSTED_API = 'https://workspace-endpoint.openagents.org';

/** Preview CSP permits assets on the backend origin and ticket path. The web
 * API proxy changes both, so ticket-scoped frames must use the direct endpoint.
 * Creating the preview ticket still uses the normal authenticated transport.
 */
export function getProjectPreviewUrl(path: string, apiBase = getApiBaseUrl()): string {
  return (apiBase === '/wsapi' ? HOSTED_API : apiBase) + path;
}

/** Use Next's same-origin proxy on the web; native and custom endpoints stay direct. */
export function getApiBaseUrl(configured = process.env.NEXT_PUBLIC_API_URL): string {
  const base = (configured || HOSTED_API).replace(/\/+$/, '');
  if (
    base === HOSTED_API &&
    typeof window !== 'undefined' &&
    /^https?:$/.test(window.location.protocol) &&
    !desktopHost()
  ) {
    return '/wsapi';
  }
  return base;
}

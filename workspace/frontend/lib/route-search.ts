/**
 * The current route's query string, `''` or `'?…'`.
 *
 * On the web that is `location.search`. The desktop build routes by hash
 * (`index.html#/acme?token=…`, see desktop/router), so there the query lives
 * inside the hash and `location.search` is always empty — reading it there
 * silently dropped a `?token=` on every hop into settings and back.
 */
export function currentRouteSearch(): string {
  if (typeof window === 'undefined') return '';
  const { search, hash } = window.location;
  if (search) return search;
  if (!hash.startsWith('#/')) return '';
  const at = hash.indexOf('?');
  return at >= 0 ? hash.slice(at) : '';
}

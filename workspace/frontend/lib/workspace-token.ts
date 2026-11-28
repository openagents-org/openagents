import { getApiBaseUrl } from './api-base';

/** Resolve the credential using the same endpoint as the connector. */
export async function resolveWorkspaceToken(token: string): Promise<string> {
  const response = await fetch(`${getApiBaseUrl()}/v1/token/resolve`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (response.status === 404 || response.status === 401) throw new Error('invalid');
  const result = await response.json();
  const slug = result?.data?.slug;
  if (!response.ok || result.code !== 0 || typeof slug !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) throw new Error('unavailable');
  return slug;
}

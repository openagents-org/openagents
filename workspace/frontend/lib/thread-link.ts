import { dmPair } from './dm';

export const isOpaqueThreadId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function threadPath(workspace: string, thread: string): string {
  return `/${encodeURIComponent(workspace)}/threads/${encodeURIComponent(thread)}`;
}

/** A navigational link carries no workspace token and grants no access. */
export function threadLink(origin: string, workspace: string, thread: string): string {
  return new URL(threadPath(workspace, thread), origin).toString();
}

export function messageLink(origin: string, workspace: string, thread: string, message: string): string {
  const url = new URL(threadLink(origin, workspace, thread));
  url.searchParams.set('message', message);
  return url.toString();
}

export function requestedMessageId(search: string): string | null {
  const value = new URLSearchParams(search).get('message');
  return value && value.length <= 256 ? value : null;
}

/** Read canonical paths, while continuing to accept previously shared links. */
export function requestedThreadId(location: string): string | null {
  try {
    const url = new URL(location, 'https://workspace.invalid');
    const match = url.pathname.match(/^\/[^/]+\/threads\/([^/]+)\/?$/);
    if (match) return decodeURIComponent(match[1]);
    return url.searchParams.get('thread');
  } catch { return null; }
}

/** Discovery already contains only accessible channels. DMs must include the viewer. */
export function resolveThreadLink(location: string, channels: readonly string[], viewerAddress: string): string | null {
  const thread = requestedThreadId(location);
  if (!thread) return null;
  if (channels.includes(thread)) return thread;
  const pair = dmPair(thread);
  return pair.length === 2 && pair.includes(viewerAddress) ? thread : null;
}

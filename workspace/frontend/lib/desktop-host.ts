import type { WorkspaceSession } from './workspace-session';

/** Optional desktop capabilities. The web application has no host bridge. */
export interface DesktopComputer {
  hostname: string;
  deviceType: string;
  /** This computer's registration in the requested workspace only. */
  nodeId: string | null;
  warning: boolean;
}

export interface DesktopHost {
  openComputer(): void;
  signIn(): void;
  signOut(): void;
  connectComputer(workspaceId: string): Promise<DesktopComputer>;
  getComputerStatus(workspaceId: string): Promise<DesktopComputer>;
  /** Surface a newly observed agent reply through the launcher's OS notifications. */
  notifyAgentReply?(input: {
    workspaceId: string;
    sessionId: string;
    eventId: string;
    sender: string;
    content: string;
  }): void;
  /**
   * The desktop app owns the session and tells the page when it is renewed.
   * Optional: an older preload can briefly coexist with a newer bundle in dev.
   */
  onSession?(callback: (session: WorkspaceSession) => void): () => void;
}

export function desktopHost(): DesktopHost | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __oaHost__?: DesktopHost }).__oaHost__ ?? null;
}

/** Resolve a notification deep link only after that workspace's threads load. */
export function requestedDesktopThread(hash: string, sessionIds: string[]): string | null {
  const queryAt = hash.indexOf('?');
  if (queryAt < 0) return null;
  const requested = new URLSearchParams(hash.slice(queryAt + 1)).get('thread');
  return requested && sessionIds.includes(requested) ? requested : null;
}

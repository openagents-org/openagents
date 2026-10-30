// A message a link asked to show, held until the thread it belongs to is the
// one on screen. Switching threads and loading its messages happen after the
// click, so the request has to outlive it.

export const MESSAGE_TARGET_EVENT = 'workspace:message-target';

let pending: { sessionId: string; messageId: string } | null = null;

export function requestMessageTarget(sessionId: string, messageId: string): void {
  pending = { sessionId, messageId };
  window.dispatchEvent(new CustomEvent(MESSAGE_TARGET_EVENT));
}

/** The requested message, once, if it belongs to `sessionId`. */
export function takeMessageTarget(sessionId: string | null | undefined): string | null {
  if (!pending || !sessionId || pending.sessionId !== sessionId) return null;
  const { messageId } = pending;
  pending = null;
  return messageId;
}

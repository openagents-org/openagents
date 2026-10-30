import type { ONMEvent } from './types';

/** A channel's newest visible agent reply since the last discovery snapshot. */
export function newDesktopAgentReply(events: ONMEvent[], previousAt: number | null | undefined): ONMEvent | null {
  if (previousAt == null) return null;
  return events.find((event) => {
    const type = event.payload?.message_type || 'chat';
    return event.type === 'workspace.message.posted' && event.timestamp > previousAt &&
      event.source.startsWith('openagents:') &&
      type === 'chat' && typeof event.payload?.content === 'string' && !!event.payload.content.trim();
  }) ?? null;
}

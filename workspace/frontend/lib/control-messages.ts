import type { WorkspaceMessage } from './types';

/**
 * Control messages are posted to a thread so agents (and other clients) can
 * act on them, but they are not conversation: today that is the queue-cancel
 * signal (`__queue_cancel:<id>`, message_type `queue_cancel`) the Queue tab
 * sends. No surface should render one as something a person said.
 */
const CONTROL_MESSAGE_TYPES = new Set(['queue_cancel']);

export function isControlMessage(msg: Pick<WorkspaceMessage, 'messageType'> | null | undefined): boolean {
  return !!msg && CONTROL_MESSAGE_TYPES.has(msg.messageType);
}

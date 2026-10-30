import type { MessageKey } from './i18n/translate';

/**
 * The explanation for a node command the API refused (`API <status>: <body>`),
 * or null when there is nothing more specific to say than its own message.
 *
 * A 403 has several causes, and calling every one of them "not the connection
 * owner" sent the owner of a connection looking for a permission problem when
 * the real one was an agent name already taken.
 */
export function nodeCommandErrorKey(message: string, creating = false): MessageKey | null {
  if (/belongs to a different connection/i.test(message)) {
    return creating ? 'connect.agentNameTaken' : 'connect.agentOnOtherConnection';
  }
  if (/^API 401\b/.test(message)) return 'connect.nodeCommandSignIn';
  if (/^API 403\b/.test(message)) return 'connect.nodeCommandForbidden';
  return null;
}

/**
 * The agent name a create_agent command collided with on the device, or null.
 *
 * The device refuses a name already in its own config. That agent is often
 * invisible here — left over from an earlier failed add, created on the device
 * itself, or bound to another workspace — so the bare "already exists" gave
 * the user nothing to go on.
 */
export function deviceNameClash(message: string | null | undefined): string | null {
  const m = /Agent '([^']+)' already exists/.exec(message || '');
  return m ? m[1] : null;
}

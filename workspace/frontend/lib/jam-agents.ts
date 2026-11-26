/**
 * Adding agents to a jam (OpenAgents Jam): name rules, the agent types a
 * jam accepts, and the paste-ready instructions. Kept free of React so it
 * can be unit tested.
 */

/** Runtimes a jam agent can use; Claude Code is the default. */
export const JAM_AGENT_TYPES = ['claude', 'codex', 'opencode', 'openclaw', 'hermes', 'gemini', 'cursor', 'aider', 'goose'] as const;
export type JamAgentType = typeof JAM_AGENT_TYPES[number];

/** Only these can take other people's requests (run them read-only). */
export const GUEST_CAPABLE_TYPES: readonly string[] = ['claude'];

export const AGENT_NAME_MAX = 48;

/** Why a name won't do, or null: letters, digits, `-` and `_`, starting with a letter or digit, up to 48. */
export function agentNameProblem(name: string): 'empty' | 'spaces' | 'chars' | 'start' | 'long' | null {
  if (!name) return 'empty';
  if (/\s/.test(name)) return 'spaces';
  if (name.length > AGENT_NAME_MAX) return 'long';
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'chars';
  if (!/^[A-Za-z0-9]/.test(name)) return 'start';
  return null;
}

/** One paragraph to paste into a coding agent so it connects the new agent itself. */
export function connectParagraph(commands: string[], intro: string): string {
  return `${intro}\n\n${commands.join('\n')}`;
}

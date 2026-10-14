import type { WorkspaceSession } from './types';

/** Keep canonical decision-log keys intact for connectors; display the thread name. */
export function knowledgeTitle(title: string, sessions: Pick<WorkspaceSession, 'sessionId' | 'title'>[]): string {
  const match = /^(Decisions|Glossary) for channel (.+)$/.exec(title);
  if (!match) return title;
  const session = sessions.find(item => item.sessionId === match[2]);
  const name = session?.title?.trim();
  if (name && !/^(channel|session)-[a-f0-9-]+$/i.test(name)) return `${match[1]} · ${name}`;
  if (/^(channel|session)-[a-f0-9-]+$/i.test(match[2])) return match[1];
  return `${match[1]} · ${match[2].replace(/^routines?:/, '')}`;
}

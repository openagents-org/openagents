import { workspaceApi } from './api';
import type { Grantee } from './types';

export const THREAD_PARTICIPANTS_CHANGED = 'thread-participants-changed';

/** People join the human roster; agents must join the conversation, not just receive a read grant. */
export async function addThreadParticipants(channel: string, picks: readonly Grantee[]) {
  const added: Grantee[] = [];
  const failed: Grantee[] = [];
  const invites: { email: string; url: string }[] = [];
  for (const person of picks) {
    try {
      if (person.kind === 'human') {
        const result = await workspaceApi.inviteHumanToChannel(channel, person.id);
        if (!result.added) {
          invites.push({ email: person.id, url: result.invite_url });
          continue;
        }
      } else if (person.kind === 'agent') {
        await workspaceApi.addChannelParticipant(channel, person.id);
      } else {
        throw new Error('Only people and agents can join a thread');
      }
      added.push(person);
    } catch {
      failed.push(person);
    }
  }
  return { added, failed, invites };
}

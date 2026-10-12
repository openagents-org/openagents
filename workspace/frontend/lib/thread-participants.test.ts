import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceApi } from './api';
import { addThreadParticipants } from './thread-participants';
import type { Grantee } from './types';

vi.mock('./api', () => ({ workspaceApi: {
  inviteHumanToChannel: vi.fn(),
  addChannelParticipant: vi.fn(),
} }));

const person: Grantee = { kind: 'human', id: 'sam@example.com', label: 'Sam' };
const agent: Grantee = { kind: 'agent', id: 'scout', label: 'Scout' };

describe('addThreadParticipants', () => {
  beforeEach(() => vi.resetAllMocks());

  it('adds people to the human roster and agents to the actual conversation', async () => {
    vi.mocked(workspaceApi.inviteHumanToChannel).mockResolvedValue({ added: true, email: person.id });
    vi.mocked(workspaceApi.addChannelParticipant).mockResolvedValue();
    expect(await addThreadParticipants('thread-1', [person, agent]))
      .toEqual({ added: [person, agent], failed: [], invites: [] });
    expect(workspaceApi.inviteHumanToChannel).toHaveBeenCalledWith('thread-1', person.id);
    expect(workspaceApi.addChannelParticipant).toHaveBeenCalledWith('thread-1', agent.id);
  });

  it('retains failed selections for retry while adding the other selections', async () => {
    vi.mocked(workspaceApi.inviteHumanToChannel).mockRejectedValue(new Error('Forbidden'));
    vi.mocked(workspaceApi.addChannelParticipant).mockResolvedValue();
    expect(await addThreadParticipants('thread-1', [person, agent]))
      .toEqual({ added: [agent], failed: [person], invites: [] });
  });

  it('returns invite links without reporting invitees as joined participants', async () => {
    vi.mocked(workspaceApi.inviteHumanToChannel).mockResolvedValue({
      added: false, invited: true, invite_token: 'test', invite_url: 'https://example.com/invite/test',
    });
    expect(await addThreadParticipants('thread-1', [person]))
      .toEqual({ added: [], failed: [], invites: [{ email: person.id, url: 'https://example.com/invite/test' }] });
  });
});

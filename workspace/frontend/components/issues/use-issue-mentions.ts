'use client';
import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import type { TeamMember } from '@/lib/types';
import { issueMentionOptions } from './issue-mentions';

export function useIssueMentions(
  issue?: Parameters<typeof issueMentionOptions>[0]['issue'],
) {
  const { workspace, currentUser, agents, onlineUsers } = useWorkspace();
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    let active = true;
    setTeam([]);
    workspaceApi
      .getTeam()
      .then((members) => {
        if (active) setTeam(members);
      })
      .catch(() => {
        /* Guests can still mention people already in the discussion. */
      });
    return () => {
      active = false;
    };
  }, [workspace?.workspaceId]);
  return issueMentionOptions({ team, agents, onlineUsers, currentUser, issue });
}

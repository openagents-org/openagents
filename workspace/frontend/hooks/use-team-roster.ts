'use client';
import { useEffect, useMemo, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import type { TeamMember } from '@/lib/types';

/**
 * The workspace's human roster, fetched once per workspace and shared by every
 * caller (composer @ picker, mention rendering, DM titles). Token-only / guest
 * sessions may not be allowed to read the team — they get an empty roster.
 */
const cache = new Map<string, Promise<TeamMember[]>>();

export function loadTeamRoster(workspaceId: string): Promise<TeamMember[]> {
  let p = cache.get(workspaceId);
  if (!p) {
    p = workspaceApi.getTeam().catch(() => {
      cache.delete(workspaceId);
      return [] as TeamMember[];
    });
    cache.set(workspaceId, p);
  }
  return p;
}

export function useTeamRoster(): TeamMember[] {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.workspaceId ?? null;
  const [team, setTeam] = useState<{ id: string | null; members: TeamMember[] }>({ id: null, members: [] });
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    loadTeamRoster(workspaceId).then((members) => {
      if (active) setTeam({ id: workspaceId, members });
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);
  return team.id === workspaceId ? team.members : [];
}

/** email (lowercased) → display name, for every roster member. */
export function useHumanNames(): Record<string, string> {
  const team = useTeamRoster();
  return useMemo(() => {
    const names: Record<string, string> = {};
    for (const m of team) {
      if (!m.email) continue;
      names[m.email.toLowerCase()] = (m.displayName || '').trim() || m.email;
    }
    return names;
  }, [team]);
}

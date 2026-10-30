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
// Dropped here rather than by the hooks: a profile is saved from Settings,
// while the views that show it are unmounted or hidden and listen to nothing.
if (typeof window !== 'undefined') window.addEventListener('workspace-profile-updated', () => cache.clear());
/** What a failed load resolves to: empty for now, but worth asking again. */
const FAILED: TeamMember[] = [];
const RETRIES = 3;

export function loadTeamRoster(workspaceId: string): Promise<TeamMember[]> {
  let p = cache.get(workspaceId);
  if (!p) {
    p = workspaceApi.getTeam().catch(() => {
      cache.delete(workspaceId);
      return FAILED;
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
    // One failed request used to leave names and avatars missing until reload.
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = (invalidate = false) => {
      if (invalidate) cache.delete(workspaceId);
      void loadTeamRoster(workspaceId).then(members => {
        if (!active) return;
        setTeam({ id: workspaceId, members });
        if (members !== FAILED) { failures = 0; return; }
        if (failures >= RETRIES) return;
        failures += 1;
        clearTimeout(retry);
        retry = setTimeout(() => refresh(), failures * 5000);
      });
    };
    refresh();
    const onProfile = () => refresh();
    window.addEventListener('workspace-profile-updated', onProfile);
    return () => {
      active = false;
      clearTimeout(retry);
      window.removeEventListener('workspace-profile-updated', onProfile);
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

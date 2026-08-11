'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { avatarSrc, getAccountProfile } from '@/lib/account-api';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import type { AccountProfile } from '@/lib/types';

/**
 * Avatar lookup for the whole workspace, keyed by email.
 *
 * Email is the key because that's what the app already uses to identify a
 * person: `useWorkspaceIdentity` sets `currentUser.id` to the user's email, and
 * chat events carry the sender's email in `payload.sender_id`. Avatars are
 * stored against the database UUID, so this map is what bridges the two — it's
 * built from the team roster, which returns both.
 *
 * Anything not in the map (historical messages from people who left, anonymous
 * participants, agents) resolves to undefined and falls back to initials. No
 * request is made for a miss.
 */

interface AvatarsValue {
  /** The signed-in user's own profile, or null when signed out / not loaded. */
  profile: AccountProfile | null;
  /** Absolute avatar URL for an email, or undefined if there isn't one. */
  avatarFor: (email: string | null | undefined) => string | undefined;
  /** Re-read the profile and roster after the user changes their own avatar. */
  refresh: () => Promise<void>;
}

const AvatarsContext = createContext<AvatarsValue | null>(null);

export function useAvatars(): AvatarsValue {
  // Usable outside the provider (e.g. the share view, which has no workspace):
  // everything resolves empty rather than throwing.
  return (
    useContext(AvatarsContext) ?? {
      profile: null,
      avatarFor: () => undefined,
      refresh: async () => {},
    }
  );
}

export function AvatarsProvider({ children }: { children: React.ReactNode }) {
  const { idToken } = useOpenAgentsAuth();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [byEmail, setByEmail] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!idToken) {
      setProfile(null);
      setByEmail({});
      return;
    }

    // Independent of each other, and either may legitimately fail: a signed-in
    // user who isn't a member of this workspace still has a profile.
    const [profileResult, teamResult] = await Promise.allSettled([
      getAccountProfile(idToken),
      workspaceApi.getTeam(),
    ]);

    if (profileResult.status === 'fulfilled') {
      setProfile(profileResult.value);
    }

    if (teamResult.status === 'fulfilled') {
      const next: Record<string, string> = {};
      for (const member of teamResult.value) {
        const src = avatarSrc(member.avatarUrl);
        if (src) next[member.email.toLowerCase()] = src;
      }
      setByEmail(next);
    }
  }, [idToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const avatarFor = useCallback(
    (email: string | null | undefined) => (email ? byEmail[email.toLowerCase()] : undefined),
    [byEmail],
  );

  const value = useMemo(
    () => ({ profile, avatarFor, refresh: load }),
    [profile, avatarFor, load],
  );

  return <AvatarsContext.Provider value={value}>{children}</AvatarsContext.Provider>;
}

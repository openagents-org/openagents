/**
 * React hooks for avatar management
 */

import { useState, useEffect } from 'react';
import { getAvatarUrl, fetchAvatarsBatch, prefetchAvatars } from '@/utils/avatarUtils';

/**
 * Hook to get avatar URL for a single agent
 */
export function useAvatar(agentId: string, baseUrl?: string) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchAvatar = async () => {
      if (!agentId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const url = await getAvatarUrl(agentId, baseUrl);
        if (mounted) {
          setAvatarUrl(url);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchAvatar();

    return () => {
      mounted = false;
    };
  }, [agentId, baseUrl]);

  return { avatarUrl, loading, error };
}

/**
 * Hook to get avatars for multiple agents
 */
export function useAvatars(agentIds: string[], baseUrl?: string) {
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchAvatars = async () => {
      if (!agentIds || agentIds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const avatarMap = await fetchAvatarsBatch(agentIds, baseUrl);
        if (mounted) {
          setAvatars(avatarMap);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchAvatars();

    return () => {
      mounted = false;
    };
  }, [agentIds.join(','), baseUrl]); // Use join for stable dependency

  return { avatars, loading, error };
}

/**
 * Hook to prefetch avatars
 */
export function usePrefetchAvatars(agentIds: string[], baseUrl?: string) {
  useEffect(() => {
    if (agentIds && agentIds.length > 0) {
      prefetchAvatars(agentIds, baseUrl);
    }
  }, [agentIds.join(','), baseUrl]);
}

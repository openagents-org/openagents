import { useState, useEffect } from 'react';
import { useOpenAgents } from '@/context/OpenAgentsProvider';

interface UseHealthGroupsResult {
  groups: string[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Custom hook to fetch permission groups from /api/health endpoint
 * Returns list of group IDs that can be used for permission selection
 */
export const useHealthGroups = (): UseHealthGroupsResult => {
  const [groups, setGroups] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const { connector } = useOpenAgents();

  useEffect(() => {
    const fetchGroups = async () => {
      if (!connector) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const healthData = await connector.getNetworkHealth();

        if (healthData && healthData.groups && typeof healthData.groups === 'object') {
          // Extract group names from groups object keys
          setGroups(Object.keys(healthData.groups));
        } else {
          setGroups([]);
        }
      } catch (err) {
        console.error('Failed to fetch health groups:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setGroups([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchGroups();
  }, [connector]);

  return { groups, isLoading, error };
};

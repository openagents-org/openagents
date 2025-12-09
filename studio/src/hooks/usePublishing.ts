/**
 * usePublishing Hook
 * 
 * Custom hook for managing network publishing state
 */

import { useState, useEffect, useCallback } from 'react';
import { publishingApi, PublishingStatus, NetworkProfile } from '@/services/publishingApi';
import { toast } from 'sonner';

export const usePublishing = () => {
  const [status, setStatus] = useState<PublishingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch current status
  const fetchStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await publishingApi.getStatus();
      setStatus(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      console.error('Failed to fetch publishing status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Publish network
  const publish = useCallback(async (profile?: NetworkProfile) => {
    try {
      setIsLoading(true);
      await publishingApi.publish(profile);
      toast.success('Network published successfully!');
      await fetchStatus();
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to publish');
      setError(error);
      toast.error(error.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchStatus]);

  // Unpublish network
  const unpublish = useCallback(async (networkId: string) => {
    try {
      setIsLoading(true);
      await publishingApi.unpublish(networkId);
      toast.success('Network unpublished successfully');
      await fetchStatus();
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to unpublish');
      setError(error);
      toast.error(error.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchStatus]);

  // Update profile
  const updateProfile = useCallback(async (profile: NetworkProfile) => {
    try {
      setIsLoading(true);
      await publishingApi.updateProfile(profile);
      toast.success('Profile updated successfully');
      await fetchStatus();
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update profile');
      setError(error);
      toast.error(error.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchStatus]);

  // Validate network ID
  const validateNetworkId = useCallback(async (networkId: string) => {
    try {
      const result = await publishingApi.validateNetworkId(networkId);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to validate');
      toast.error(error.message);
      return { available: false, message: error.message };
    }
  }, []);

  // Send heartbeat
  const sendHeartbeat = useCallback(async () => {
    try {
      await publishingApi.sendHeartbeat();
      toast.success('Heartbeat sent successfully');
      await fetchStatus();
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to send heartbeat');
      toast.error(error.message);
      return false;
    }
  }, [fetchStatus]);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    status,
    isLoading,
    error,
    publish,
    unpublish,
    updateProfile,
    validateNetworkId,
    sendHeartbeat,
    refresh: fetchStatus,
  };
};

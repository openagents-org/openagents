'use client';
import { useChannelParticipants } from '@/lib/channel-participants-store';

/** Permissions come from the authenticated server response, never a workspace token role. */
export function useThreadAccess(channel: string) {
  return useChannelParticipants(channel);
}

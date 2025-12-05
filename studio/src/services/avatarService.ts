/**
 * Avatar service for fetching agent avatars
 */

import { httpFetch } from "@/utils/httpClient";

export interface AvatarInfo {
  has_avatar: boolean;
  avatar_url: string | null;
}

export interface BatchAvatarResponse {
  success: boolean;
  avatars: Record<string, string | null>;
}

/**
 * Get avatar URL for a single agent
 */
export const getAvatarUrl = (
  agentId: string,
  networkHost?: string,
  networkPort?: number
): string | null => {
  if (!networkHost || !networkPort) {
    return null;
  }

  // Construct base URL
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const baseUrl = `${protocol}//${networkHost}:${networkPort}`;
  
  return `${baseUrl}/api/avatars/${agentId}.png`;
};

/**
 * Get avatars for multiple agents
 */
export const getBatchAvatars = async (
  agentIds: string[],
  networkHost?: string,
  networkPort?: number
): Promise<Record<string, string | null>> => {
  if (!networkHost || !networkPort || agentIds.length === 0) {
    return {};
  }

  try {
    // Construct base URL
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const baseUrl = `${protocol}//${networkHost}:${networkPort}`;
    const url = `${baseUrl}/api/avatars/batch`;

    const response = await httpFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agent_ids: agentIds }),
    });

    if (!response.ok) {
      console.warn(`Failed to fetch batch avatars: ${response.status}`);
      return {};
    }

    const data: BatchAvatarResponse = await response.json();
    
    if (data.success && data.avatars) {
      // Convert relative URLs to absolute URLs
      const result: Record<string, string | null> = {};
      for (const [agentId, avatarUrl] of Object.entries(data.avatars)) {
        if (avatarUrl) {
          // If it's a relative URL, make it absolute
          if (avatarUrl.startsWith("/")) {
            result[agentId] = `${baseUrl}${avatarUrl}`;
          } else {
            result[agentId] = avatarUrl;
          }
        } else {
          result[agentId] = null;
        }
      }
      return result;
    }

    return {};
  } catch (error) {
    console.error("Error fetching batch avatars:", error);
    return {};
  }
};


/**
 * Avatar utilities for fetching and caching agent avatars
 */

const AVATAR_CACHE = new Map<string, string | null>();
const AVATAR_LOADING = new Set<string>();

/**
 * Fetch avatars for multiple agents
 */
export async function fetchAvatarsBatch(
  agentIds: string[],
  baseUrl?: string
): Promise<Map<string, string | null>> {
  const url = baseUrl ? `${baseUrl}/api/avatars/batch` : '/api/avatars/batch';
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_ids: agentIds }),
    });

    if (!response.ok) {
      console.warn('Failed to fetch avatars batch:', response.status);
      return new Map();
    }

    const data = await response.json();
    const avatars = new Map<string, string | null>();

    // Cache the results
    for (const [agentId, avatarUrl] of Object.entries(data.avatars as Record<string, string | null>)) {
      const fullUrl = avatarUrl && baseUrl ? `${baseUrl}${avatarUrl}` : avatarUrl;
      avatars.set(agentId, fullUrl);
      AVATAR_CACHE.set(agentId, fullUrl);
    }

    return avatars;
  } catch (error) {
    console.error('Error fetching avatars batch:', error);
    return new Map();
  }
}

/**
 * Get avatar URL from cache or fetch it
 */
export async function getAvatarUrl(
  agentId: string,
  baseUrl?: string
): Promise<string | null> {
  // Check cache first
  if (AVATAR_CACHE.has(agentId)) {
    return AVATAR_CACHE.get(agentId) || null;
  }

  // Avoid duplicate requests
  if (AVATAR_LOADING.has(agentId)) {
    // Wait for existing request
    await new Promise(resolve => setTimeout(resolve, 100));
    return AVATAR_CACHE.get(agentId) || null;
  }

  AVATAR_LOADING.add(agentId);

  try {
    const avatars = await fetchAvatarsBatch([agentId], baseUrl);
    return avatars.get(agentId) || null;
  } finally {
    AVATAR_LOADING.delete(agentId);
  }
}

/**
 * Prefetch avatars for multiple agents
 */
export function prefetchAvatars(agentIds: string[], baseUrl?: string): void {
  // Filter out already cached agents
  const uncachedIds = agentIds.filter(id => !AVATAR_CACHE.has(id));
  
  if (uncachedIds.length === 0) {
    return;
  }

  // Fetch in background without waiting
  fetchAvatarsBatch(uncachedIds, baseUrl).catch(error => {
    console.error('Error prefetching avatars:', error);
  });
}

/**
 * Clear avatar cache
 */
export function clearAvatarCache(): void {
  AVATAR_CACHE.clear();
}

/**
 * Get placeholder color for an agent
 */
export function getPlaceholderColor(agentId: string): string {
  // Generate deterministic color from agent ID
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = agentId.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 60%, 55%)`;
}

/**
 * Get initials from agent ID
 */
export function getInitials(agentId: string): string {
  if (!agentId) return '?';
  
  // Remove @ prefix if present
  const name = agentId.startsWith('@') ? agentId.slice(1) : agentId;
  
  // Split by common separators
  const parts = name.split(/[@_.-]/);
  
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  
  return name[0].toUpperCase();
}

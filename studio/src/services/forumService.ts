/**
 * Forum service for detecting and interacting with the forum mod
 */

export interface ForumModInfo {
  available: boolean;
  version?: string;
}

/**
 * Check if the forum mod is available on the network
 */
export async function checkForumModAvailability(baseUrl: string): Promise<ForumModInfo> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return { available: false };
    }

    const healthData = await response.json();
    
    // Check if forum mod is in the mods list
    const mods = healthData.mods || [];
    const hasForumMod = mods.some((mod: any) => {
      // Handle both string format and object format
      const modName = typeof mod === 'string' ? mod : mod.name;
      return modName && (modName.includes('forum') || modName.includes('openagents.mods.workspace.forum'));
    });

    return {
      available: hasForumMod,
      version: healthData.version
    };
  } catch (error) {
    console.error('Failed to check forum mod availability:', error);
    return { available: false };
  }
}

/**
 * Get forum mod status from health data
 */
export function getForumModStatus(healthData: any): ForumModInfo {
  if (!healthData || !healthData.mods) {
    return { available: false };
  }

  const mods = healthData.mods || [];
  const hasForumMod = mods.some((mod: any) => {
    // Handle both string format and object format
    const modName = typeof mod === 'string' ? mod : mod.name;
    return modName && (modName.includes('forum') || modName.includes('openagents.mods.workspace.forum'));
  });

  return {
    available: hasForumMod,
    version: healthData.version
  };
}
/**
 * Wiki service for detecting and interacting with the wiki mod
 */

export interface WikiModInfo {
  available: boolean;
  version?: string;
}

/**
 * Check if the wiki mod is available on the network
 */
export async function checkWikiModAvailability(baseUrl: string): Promise<WikiModInfo> {
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
    
    // Check if wiki mod is in the mods list
    const mods = healthData.mods || [];
    const hasWikiMod = mods.some((mod: any) => {
      // Handle both string format and object format
      const modName = typeof mod === 'string' ? mod : mod.name;
      return modName && (modName.includes('wiki') || modName.includes('openagents.mods.workspace.wiki'));
    });

    return {
      available: hasWikiMod,
      version: healthData.version
    };
  } catch (error) {
    console.error('Failed to check wiki mod availability:', error);
    return { available: false };
  }
}

/**
 * Get wiki mod status from health data
 */
export function getWikiModStatus(healthData: any): WikiModInfo {
  if (!healthData || !healthData.mods) {
    return { available: false };
  }

  const mods = healthData.mods || [];
  const hasWikiMod = mods.some((mod: any) => {
    // Handle both string format and object format
    const modName = typeof mod === 'string' ? mod : mod.name;
    return modName && (modName.includes('wiki') || modName.includes('openagents.mods.workspace.wiki'));
  });

  return {
    available: hasWikiMod,
    version: healthData.version
  };
}
/**
 * Mod UI Loader
 * 
 * Dynamically loads mod UI components from pre-built static files.
 */

import { ModUIConfig, HealthResponse } from './moduleUtils'

export interface LoadedModUI {
  modName: string
  config: ModUIConfig
  component: React.ComponentType<any> | null
  error?: string
}

const loadedModUIs: Map<string, LoadedModUI> = new Map()

/**
 * Extract mod name from full mod path
 * Example: 'openagents.mods.workspace.wiki' -> 'wiki'
 */
export const extractModName = (fullModName: string): string => {
  return fullModName.split('.').pop() || fullModName
}

/**
 * Get mod UI base URL for loading static files
 */
export const getModUIBaseURL = (modName: string): string => {
  const shortName = extractModName(modName)
  return `/mod-ui/${modName}/`
}

/**
 * Load a mod UI component dynamically
 */
export const loadModUI = async (
  modName: string,
  config: ModUIConfig
): Promise<LoadedModUI> => {
  // Check if already loaded
  if (loadedModUIs.has(modName)) {
    return loadedModUIs.get(modName)!
  }

  const shortName = extractModName(modName)
  const loadedUI: LoadedModUI = {
    modName,
    config,
    component: null,
  }

  try {
    // Construct the entry file URL
    const baseURL = getModUIBaseURL(modName)
    const entryURL = `${baseURL}${config.entry.replace(/^ui\/dist\//, '')}`

    // Dynamically import the mod UI component
    // Note: This assumes the mod UI is built as an ES module
    const module = await import(/* @vite-ignore */ entryURL)
    
    // Try to find the default export or a named export
    loadedUI.component = module.default || module.ModUI || module.Component || null

    if (!loadedUI.component) {
      throw new Error(`No component found in mod UI entry: ${entryURL}`)
    }

    console.log(`✅ Successfully loaded mod UI: ${modName}`)
    
    // Dispatch event to notify that mod UI is loaded
    window.dispatchEvent(new CustomEvent('mod-ui-loaded', { detail: { modName } }))
  } catch (error: any) {
    console.error(`❌ Failed to load mod UI ${modName}:`, error)
    loadedUI.error = error.message || 'Failed to load mod UI'
  }

  loadedModUIs.set(modName, loadedUI)
  return loadedUI
}

/**
 * Load all mod UIs from health response
 */
export const loadModUIsFromHealth = async (
  healthResponse: HealthResponse
): Promise<LoadedModUI[]> => {
  const modUIs = healthResponse.data?.mod_uis || {}
  const loaded: LoadedModUI[] = []

  for (const [modName, config] of Object.entries(modUIs)) {
    if (config.enabled) {
      try {
        const loadedUI = await loadModUI(modName, config)
        loaded.push(loadedUI)
      } catch (error) {
        console.error(`Failed to load mod UI ${modName}:`, error)
      }
    }
  }

  return loaded
}

/**
 * Get all loaded mod UIs
 */
export const getLoadedModUIs = (): LoadedModUI[] => {
  return Array.from(loadedModUIs.values())
}

/**
 * Get a specific loaded mod UI by mod name
 */
export const getLoadedModUI = (modName: string): LoadedModUI | undefined => {
  return loadedModUIs.get(modName)
}

/**
 * Clear all loaded mod UIs (useful for cleanup)
 */
export const clearLoadedModUIs = (): void => {
  loadedModUIs.clear()
}


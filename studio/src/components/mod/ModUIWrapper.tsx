/**
 * Mod UI Wrapper Component
 * 
 * Dynamically loads and renders mod UI components.
 */

import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getLoadedModUI } from '@/utils/modUILoader'

interface ModUIWrapperProps {
  modName: string
}

const ModUIWrapper: React.FC<ModUIWrapperProps> = ({ modName }) => {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadComponent = async () => {
      try {
        const loadedUI = getLoadedModUI(modName)
        
        if (!loadedUI) {
          setError(`Mod UI not found: ${modName}`)
          setLoading(false)
          return
        }

        if (loadedUI.error) {
          setError(loadedUI.error)
          setLoading(false)
          return
        }

        if (loadedUI.component) {
          setComponent(() => loadedUI.component!)
        } else {
          setError('Mod UI component not loaded')
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load mod UI')
      } finally {
        setLoading(false)
      }
    }

    loadComponent()
  }, [modName])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading mod UI...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            Failed to Load Mod UI
          </h3>
          <p className="text-red-600 dark:text-red-300">{error}</p>
        </div>
      </div>
    )
  }

  if (!Component) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">Mod UI component not available</p>
        </div>
      </div>
    )
  }

  return <Component />
}

export default ModUIWrapper


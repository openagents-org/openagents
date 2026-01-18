import React, { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Save, Check, AlertCircle, FileText } from "lucide-react"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import { useAuthStore } from "@/stores/authStore"
import { useThemeStore } from "@/stores/themeStore"
import LazyMonacoEditor from "@/components/editors/LazyMonacoEditor"

interface NetworkProfileData {
  name?: string
  description?: string
  readme?: string
  discoverable?: boolean
  required_openagents_version?: string
  [key: string]: unknown
}

const NetworkReadme: React.FC = () => {
  const { t } = useTranslation("admin")
  const { connector } = useOpenAgents()
  const { agentName } = useAuthStore()
  const { theme } = useThemeStore()

  const [readme, setReadme] = useState("")
  const [originalReadme, setOriginalReadme] = useState("")
  const [networkProfile, setNetworkProfile] =
    useState<NetworkProfileData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState("")

  const hasChanges = readme !== originalReadme

  // Determine Monaco theme based on app theme
  const monacoTheme = theme === "dark" ? "vs-dark" : "light"

  // Load current README on mount
  useEffect(() => {
    const loadReadme = async () => {
      if (!connector) {
        setIsLoading(false)
        return
      }

      try {
        const healthResponse = await connector.getNetworkHealth()
        const profile = healthResponse?.network_profile
        const currentReadme = profile?.readme || healthResponse?.readme || ""
        setReadme(currentReadme)
        setOriginalReadme(currentReadme)
        setNetworkProfile(profile || null)
      } catch (error) {
        console.error("Failed to load README:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadReadme()
  }, [connector])

  const handleSave = async () => {
    if (!connector) return

    setIsSaving(true)
    setSaveSuccess(false)
    setSaveError("")

    try {
      // Build profile payload with required fields from existing profile
      // These fields are required by MergedNetworkProfile validation
      const profilePayload: NetworkProfileData = {
        readme: readme,
        // Always include required fields with defaults if not present
        discoverable: networkProfile?.discoverable ?? false,
        required_openagents_version:
          networkProfile?.required_openagents_version || "0.8.0",
      }

      // Include other fields if they exist in the current profile
      if (networkProfile) {
        if (networkProfile.name) {
          profilePayload.name = networkProfile.name
        }
        if (networkProfile.description) {
          profilePayload.description = networkProfile.description
        }
      }

      const response = await connector.sendEvent({
        event_name: "system.update_network_profile",
        source_id: agentName || "system",
        payload: {
          agent_id: agentName || "system",
          profile: profilePayload,
        },
      })

      if (response.success) {
        setSaveSuccess(true)
        setOriginalReadme(readme)
        setTimeout(() => setSaveSuccess(false), 3000)
      } else {
        setSaveError(response.message || t("readme.saveFailed"))
      }
    } catch (error) {
      console.error("Failed to save README:", error)
      setSaveError(t("readme.saveFailed"))
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = () => {
    setReadme("")
  }

  const handleReset = () => {
    setReadme(originalReadme)
  }

  const handleEditorChange = (value: string | undefined) => {
    setReadme(value || "")
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col dark:bg-zinc-950">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
            {t("readme.title")}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {t("readme.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-zinc-800 rounded-lg">
            <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            {originalReadme ? (
              <span className="text-sm text-green-600 dark:text-green-400">
                {originalReadme.length} {t("readme.characters")}
              </span>
            ) : (
              <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                {t("readme.notConfigured")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Editor Card */}
      <div className="flex-1 flex flex-col bg-white dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden min-h-0">
        {/* Editor Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-zinc-900/50">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("readme.label")}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("readme.hint")}
          </span>
        </div>

        {/* Monaco Editor */}
        <div className="flex-1 min-h-0">
          <LazyMonacoEditor
            height="100%"
            language="markdown"
            theme={monacoTheme}
            value={readme}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 16, bottom: 16 },
              renderWhitespace: "none",
              tabSize: 2,
              insertSpaces: true,
              folding: true,
              lineHeight: 22,
              fontFamily:
                "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            }}
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center justify-between">
            {/* Left side - status messages */}
            <div className="flex items-center gap-4">
              {saveSuccess && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="w-4 h-4" />
                  <span>{t("readme.saveSuccess")}</span>
                </div>
              )}
              {saveError && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  <span>{saveError}</span>
                </div>
              )}
              {!saveSuccess && !saveError && (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <AlertCircle className="w-4 h-4" />
                  <span>{t("readme.info")}</span>
                </div>
              )}
            </div>

            {/* Right side - buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClear}
                disabled={isSaving || !readme}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("readme.clearButton")}
              </button>
              {hasChanges && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t("readme.resetButton")}
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>{t("readme.saving")}</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>{t("readme.saveButton")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NetworkReadme

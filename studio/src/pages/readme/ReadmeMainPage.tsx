import React, { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { FileText } from "lucide-react"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import { useReadmeStore } from "@/stores/readmeStore"
import MarkdownRenderer from "@/components/common/MarkdownRenderer"
import { EmptyState } from "@/components/layout/ui/empty-state"

/**
 * README Main Page - Displays README content fetched from /api/health
 */
const ReadmeMainPage: React.FC = () => {
  const { t } = useTranslation("readme")
  const { connector } = useOpenAgents()
  const [readmeContent, setReadmeContent] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const setStoreContent = useReadmeStore((state) => state.setContent)

  useEffect(() => {
    const fetchReadme = async () => {
      if (!connector) {
        setError(t("error.notConnected"))
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const healthData = await connector.getNetworkHealth()

        // Get readme field from healthData
        // readme may be in network_profile.readme or directly in healthData.readme
        const readme =
          healthData?.network_profile?.readme || healthData?.readme || ""

        if (readme) {
          setReadmeContent(readme)
          setStoreContent(readme)
        } else {
          setReadmeContent("")
          setStoreContent("")
        }
      } catch (err) {
        console.error("Failed to fetch README:", err)
        setError(err instanceof Error ? err.message : t("error.default"))
        setReadmeContent("")
        setStoreContent("")
      } finally {
        setLoading(false)
      }
    }

    fetchReadme()
  }, [connector, setStoreContent, t])

  // Loading state component
  const LoadingState = () => (
    <div className="p-6 dark:bg-zinc-950 h-full">
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600 dark:text-gray-400">
          {t("loading")}
        </span>
      </div>
    </div>
  )

  // Error state component
  const ErrorState = () => (
    <div className="p-6 dark:bg-zinc-950 h-full flex items-center justify-center">
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-center justify-center">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-red-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3 text-center">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              {t("error.title")}
            </h3>
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          </div>
        </div>
      </div>
    </div>
  )

  // Empty content state component
  const ReadmeEmptyState = () => (
    <div className="h-full flex items-center justify-center dark:bg-zinc-950 p-6">
      <EmptyState
        variant="minimal"
        icon={<FileText className="w-12 h-12" />}
        title={t("empty.title")}
        description={t("empty.description")}
      />
    </div>
  )

  // Main content component
  const MainContent = () => {
    if (loading) {
      return <LoadingState />
    }

    if (error) {
      return <ErrorState />
    }

    if (!readmeContent) {
      return <ReadmeEmptyState />
    }

    return (
      <div className="p-6 pb-16 dark:bg-zinc-950 h-full min-h-screen overflow-y-auto">
        {/* Markdown Content */}
        <div className="bg-white dark:bg-zinc-950">
          <MarkdownRenderer
            content={readmeContent}
            className="prose prose-gray dark:prose-invert max-w-none"
            addHeadingIds={true}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <MainContent />
    </div>
  )
}

export default ReadmeMainPage

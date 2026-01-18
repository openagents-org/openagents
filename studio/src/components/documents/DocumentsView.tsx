import React, { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { DocumentsViewProps } from "../../types"
import { useThemeStore } from "@/stores/themeStore"
import { useDocumentStore } from "@/stores/documentStore"
import DocumentList from "./DocumentList"
import CreateDocumentModal from "./CreateDocumentModal"
import { Button } from "@/components/layout/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
  CardToolbar,
} from "@/components/layout/ui/card"
import { Plus, Users } from "lucide-react"

const DocumentsView: React.FC<DocumentsViewProps> = ({
  onBackClick,
  // Shared state props (optional)
  documents: sharedDocuments,
  selectedDocumentId: sharedSelectedDocumentId,
  onDocumentSelect: sharedOnDocumentSelect,
  onDocumentsChange: sharedOnDocumentsChange,
}) => {
  const { t } = useTranslation("documents")
  const navigate = useNavigate()
  // Use theme from store
  const { theme: currentTheme } = useThemeStore()

  // Use document store
  const { documents: storeDocuments, createDocument } = useDocumentStore()

  const [selectedDocument, setSelectedDocument] = useState<string | null>(null)
  const [isLoading] = useState(false)
  const [error] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Use shared state if available, otherwise use store state
  const effectiveDocuments = sharedDocuments || storeDocuments
  const effectiveSelectedDocument = sharedSelectedDocumentId || selectedDocument

  // Get top 10 documents by active user count
  const top10ActiveDocuments = useMemo(() => {
    return [...effectiveDocuments]
      .sort((a, b) => {
        // First, sort by active user count (descending)
        const activeCountDiff = b.active_agents.length - a.active_agents.length
        if (activeCountDiff !== 0) return activeCountDiff

        // If active count is the same, sort by last modified date
        return (
          new Date(b.last_modified).getTime() -
          new Date(a.last_modified).getTime()
        )
      })
      .slice(0, 10) // Take only top 10
  }, [effectiveDocuments])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return t("list.justNow")
    if (diffMins < 60) return t("list.minutesAgo", { count: diffMins })
    if (diffHours < 24) return t("list.hoursAgo", { count: diffHours })
    if (diffDays < 7) return t("list.daysAgo", { count: diffDays })

    return date.toLocaleDateString()
  }

  const handleCreateDocument = async (name: string, content: string) => {
    try {
      const documentId = await createDocument(name, content)
      console.log("📄 Document created:", documentId)

      setShowCreateModal(false)
    } catch (err) {
      console.error("Failed to create document:", err)
    }
  }

  const handleDocumentSelect = (documentId: string) => {
    // Use shared handler if available, otherwise local state
    if (sharedOnDocumentSelect) {
      sharedOnDocumentSelect(documentId)
    } else {
      setSelectedDocument(documentId)
    }
  }

  const handleBackToList = () => {
    // Use shared handler if available, otherwise local state
    if (sharedOnDocumentSelect) {
      sharedOnDocumentSelect(null)
    } else {
      setSelectedDocument(null)
    }
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {t("view.loadingDocuments")}
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.864-.833-2.634 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h3
            className={`text-lg font-medium mb-2 ${
              currentTheme === "dark" ? "text-gray-200" : "text-gray-800"
            }`}
          >
            {t("view.connectionError")}
          </h3>
          <p
            className={`${
              currentTheme === "dark" ? "text-gray-400" : "text-gray-600"
            } mb-4`}
          >
            {error}
          </p>
          <button
            onClick={onBackClick}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t("view.backToChat")}
          </button>
        </div>
      </div>
    )
  }

  if (effectiveSelectedDocument) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
          {t("view.documentDetails")}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t("view.documentId", { id: effectiveSelectedDocument })}
        </p>
        <button
          onClick={handleBackToList}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t("view.backToList")}
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950 overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Top 10 Active Documents Section */}
        {top10ActiveDocuments.length > 0 && (
          <Card variant="default" className="border border-gray-200 dark:border-gray-700">
            <CardHeader>
              <CardHeading>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  {t("sidebar.top10ActiveDocuments")}
                </CardTitle>
              </CardHeading>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
                {top10ActiveDocuments.map((doc) => (
                  <button
                    key={doc.document_id}
                    onClick={() => navigate(`/documents/${doc.document_id}`)}
                    className="text-left p-2 rounded-md border bg-white dark:bg-zinc-950 border-gray-200 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
                        {doc.name}
                      </span>
                      {doc.active_agents.length > 0 && (
                        <div className="flex items-center ml-1 flex-shrink-0">
                          <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                          <span className="ml-0.5 text-xs text-green-600 dark:text-green-400">
                            {doc.active_agents.length}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {doc.creator}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {formatDate(doc.last_modified)}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* All Documents Section */}
        <Card variant="default" className="border-0 rounded-none shadow-none">
          <CardHeader>
            <CardHeading>
              <CardTitle>{t("view.sharedDocuments")}</CardTitle>
              <CardDescription>
                {t("view.collaborativeEditingHint")}
              </CardDescription>
            </CardHeading>
            <CardToolbar>
              <Button
                onClick={() => setShowCreateModal(true)}
                variant="primary"
                size="md"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                {t("view.newDocument")}
              </Button>
            </CardToolbar>
          </CardHeader>
          <CardContent className="px-0">
            <DocumentList
              documents={effectiveDocuments}
              currentTheme={currentTheme}
              onDocumentSelect={handleDocumentSelect}
            />
          </CardContent>
        </Card>
      </div>

      {/* Create Document Modal */}
      {showCreateModal && (
        <CreateDocumentModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreateDocument={handleCreateDocument}
          currentTheme={currentTheme}
        />
      )}
    </div>
  )
}

export default DocumentsView

import React, { useEffect, useContext, useCallback } from "react"
import { Routes, Route, useNavigate } from "react-router-dom"
import { DocumentsView } from "@/components"
import { useDocumentStore } from "@/stores/documentStore"
import DocumentEditor from "@/components/documents/DocumentEditor"
import { OpenAgentsContext } from "@/context/OpenAgentsProvider"

/**
 * Documents Main Page - handles all document-related functionality
 */
const DocumentsMainPage: React.FC = () => {
  const navigate = useNavigate()

  const context = useContext(OpenAgentsContext)
  const openAgentsService = context?.connector
  const isConnected = context?.isConnected

  const {
    documents,
    selectedDocumentId,
    setSelectedDocument,
    setDocuments,
    setConnection,
    loadDocuments,
    setupEventListeners,
    cleanupEventListeners,
  } = useDocumentStore()

  // Setup connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService)
    }
  }, [openAgentsService, setConnection])

  // Load documents when connected
  useEffect(() => {
    if (openAgentsService && isConnected) {
      console.log("DocumentsMainPage: Connection ready, loading documents")
      loadDocuments()
    }
  }, [openAgentsService, isConnected, loadDocuments])

  // Setup document event listeners
  useEffect(() => {
    if (openAgentsService) {
      console.log("DocumentsMainPage: Setting up document event listeners")
      setupEventListeners()

      return () => {
        console.log("DocumentsMainPage: Cleaning up document event listeners")
        cleanupEventListeners()
      }
    }
  }, [openAgentsService, setupEventListeners, cleanupEventListeners])

  // Document selection handler
  const handleDocumentSelect = useCallback(
    (documentId: string | null) => {
      setSelectedDocument(documentId)
    },
    [setSelectedDocument]
  )

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <Routes>
        {/* Default document view */}
        <Route
          index
          element={
            <DocumentsView
              onBackClick={() => navigate("/chat")}
              documents={documents}
              selectedDocumentId={selectedDocumentId}
              onDocumentSelect={handleDocumentSelect}
              onDocumentsChange={setDocuments}
            />
          }
        />

        {/* Document editor page */}
        <Route path=":documentId" element={<DocumentEditor />} />
      </Routes>
    </div>
  )
}

export default DocumentsMainPage

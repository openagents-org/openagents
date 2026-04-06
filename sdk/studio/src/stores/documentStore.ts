import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DocumentInfo } from "@/types";
import { ThreadState } from "@/types/thread";
import { eventRouter } from "@/services/eventRouter";

// Data version number - used to control localStorage data compatibility
const STORAGE_VERSION = 2; // Increment version number to clean old data

interface DocumentStoreState {
  // Data version
  version: number;

  // Simplified thread state - only stores current selection
  threadState: ThreadState | null;

  // Document-related state
  documents: DocumentInfo[];
  selectedDocumentId: string | null;
  documentsLoading: boolean;
  documentsError: string | null;

  // Connection and event handling
  connection: any | null;
  eventHandler: ((event: any) => void) | null;

  // Thread operations
  setThreadState: (state: ThreadState | null) => void;
  updateThreadState: (updates: Partial<ThreadState>) => void;

  // Document operations
  setDocuments: (documents: DocumentInfo[]) => void;
  addDocument: (document: DocumentInfo) => void;
  updateDocument: (documentId: string, updates: Partial<DocumentInfo>) => void;
  removeDocument: (documentId: string) => void;
  setSelectedDocument: (documentId: string | null) => void;
  loadDocuments: () => Promise<void>;

  // Document content operations
  getDocumentContent: (documentId: string) => string | null;
  saveDocumentContent: (
    documentId: string,
    content: string
  ) => Promise<boolean>;
  createDocument: (name: string, content?: string) => Promise<string | null>;
  getDocument: (documentId: string) => Promise<any | null>;
  leaveDocument: (documentId: string) => Promise<boolean>;
  sendEdit: (
    documentId: string,
    operation: any,
    cursor?: { line: number; column: number }
  ) => Promise<boolean>;
  updateCursor: (
    documentId: string,
    line: number,
    column: number
  ) => Promise<boolean>;

  // Event handling
  setConnection: (connection: any | null) => void;
  setupEventListeners: () => void;
  cleanupEventListeners: () => void;
  updateOrAddDocumentToList: (document: DocumentInfo) => void;
}

// Clean up old localStorage data
const cleanupOldStorage = () => {
  try {
    const stored = localStorage.getItem("openagents_documents");
    if (stored) {
      const parsed = JSON.parse(stored);
      // Check version number, clear data if version doesn't match or doesn't exist
      if (!parsed.state?.version || parsed.state.version < STORAGE_VERSION) {
        console.log("🧹 Cleaning up old localStorage data...");
        localStorage.removeItem("openagents_documents");
      }
    }
  } catch (error) {
    console.error("Error cleaning up storage:", error);
    // If parsing fails, clean up directly
    localStorage.removeItem("openagents_documents");
  }
};

// Clean up old data before creating store
cleanupOldStorage();

export const useDocumentStore = create<DocumentStoreState>()(
  persist(
    (set, get) => ({
      // Initial state
      version: STORAGE_VERSION,
      threadState: null,
      documents: [],
      selectedDocumentId: null,
      documentsLoading: false,
      documentsError: null,
      connection: null,
      eventHandler: null,

      // Set complete thread state
      setThreadState: (state: ThreadState | null) => {
        set({ threadState: state });
      },

      // Update partial thread state
      updateThreadState: (updates: Partial<ThreadState>) => {
        set((state) => ({
          threadState: state.threadState
            ? { ...state.threadState, ...updates }
            : {
                currentChannel: null,
                currentDirectMessage: null,
                ...updates,
              },
        }));
      },

      // Set document list
      setDocuments: (documents: DocumentInfo[]) => {
        set({ documents });
      },

      // Add document
      addDocument: (document: DocumentInfo) => {
        set((state) => ({
          documents: [...state.documents, document],
        }));
      },

      // Update document
      updateDocument: (documentId: string, updates: Partial<DocumentInfo>) => {
        set((state) => ({
          documents: state.documents.map((doc) =>
            doc.document_id === documentId ? { ...doc, ...updates } : doc
          ),
        }));
      },

      // Remove document
      removeDocument: (documentId: string) => {
        set((state) => ({
          documents: state.documents.filter(
            (doc) => doc.document_id !== documentId
          ),
          // Clear selection if the removed document is currently selected
          selectedDocumentId:
            state.selectedDocumentId === documentId
              ? null
              : state.selectedDocumentId,
        }));
      },

      // Set selected document
      setSelectedDocument: (documentId: string | null) => {
        set({ selectedDocumentId: documentId });
      },

      // Load documents from backend
      loadDocuments: async () => {
        const { connection } = get();
        if (!connection) return;

        try {
          set({ documentsLoading: true, documentsError: null });

          console.log("DocumentStore: Loading documents from backend");

          const response = await connection.sendEvent({
            event_name: "document.list",
            destination_id: "mod:openagents.mods.workspace.documents",
            payload: {},
          });

          if (response.success && response.data?.documents) {
            console.log("DocumentStore: Loaded documents:", response.data.documents);

            // Convert backend data to DocumentInfo format
            const documents: DocumentInfo[] = response.data.documents.map((doc: any) => ({
              document_id: doc.document_id,
              name: doc.name,
              creator: doc.creator_agent_id,
              created: doc.created_timestamp,
              last_modified: doc.last_modified,
              active_agents: [],
            }));

            set({
              documents,
              documentsLoading: false,
            });
          } else {
            set({
              documentsError: response.message || "Failed to load documents",
              documentsLoading: false,
            });
          }
        } catch (err) {
          console.error("Failed to load documents:", err);
          set({
            documentsError: "Failed to load documents",
            documentsLoading: false,
          });
        }
      },

      // Get document content (placeholder - content should be fetched via getDocument)
      getDocumentContent: (documentId: string) => {
        // Content is managed via HTTP API now, not in local state
        return "";
      },

      // Save document content
      saveDocumentContent: async (documentId: string, content: string) => {
        const { connection } = get();
        if (!connection || !documentId) {
          console.error("Cannot save document: missing connection or documentId");
          return false;
        }

        try {
          console.log(
            `💾 Saving document ${documentId} with ${content.length} characters`
          );

          // Send document.save event to backend
          const response = await connection.sendEvent({
            event_name: "document.save",
            destination_id: "mod:openagents.mods.workspace.documents",
            payload: {
              document_id: documentId,
              content: content,
            },
          });

          if (response.success) {
            console.log("DocumentStore: Document saved successfully");

            // Update document's last modified time and version
            get().updateDocument(documentId, {
              last_modified: new Date().toISOString(),
            });

            return true;
          } else {
            console.error("DocumentStore: Failed to save document:", response.message);
            return false;
          }
        } catch (error) {
          console.error("Failed to save document:", error);
          return false;
        }
      },

      // Create new document
      createDocument: async (name: string, content: string = "") => {
        const { connection } = get();
        if (!connection || !name.trim()) {
          console.error("Cannot create document: missing connection or name");
          return null;
        }

        try {
          console.log("DocumentStore: Creating document via backend API:", { name, content });

          // Send document.create event to backend
          const response = await connection.sendEvent({
            event_name: "document.create",
            destination_id: "mod:openagents.mods.workspace.documents",
            payload: {
              document_name: name.trim(),
              initial_content: content || "",
            },
          });

          if (response.success && response.data) {
            console.log("DocumentStore: Document created successfully:", response.data);

            // Immediately add the document to local list for the creator
            const documentInfo: DocumentInfo = {
              document_id: response.data.document_id,
              name: response.data.document_name,
              creator: response.data.creator_id,
              created: new Date().toISOString(),
              last_modified: new Date().toISOString(),
              active_agents: [],
            };

            get().updateOrAddDocumentToList(documentInfo);

            // Backend will also broadcast document.created event to other users
            return response.data.document_id;
          } else {
            console.error("DocumentStore: Failed to create document:", response.message);
            return null;
          }
        } catch (error) {
          console.error("Failed to create document:", error);
          return null;
        }
      },

      // Get document detail with content and active users
      getDocument: async (documentId: string) => {
        const { connection } = get();
        if (!connection || !documentId) {
          console.error("Cannot get document: missing connection or documentId");
          return null;
        }

        try {
          console.log("DocumentStore: Getting document detail:", documentId);

          // Send document.get event to backend
          const response = await connection.sendEvent({
            event_name: "document.get",
            destination_id: "mod:openagents.mods.workspace.documents",
            payload: {
              document_id: documentId,
            },
          });

          if (response.success && response.data) {
            console.log("DocumentStore: Document detail retrieved:", response.data);

            // Update document in local list with active users
            const documentInfo: DocumentInfo = {
              document_id: response.data.document_id,
              name: response.data.document_name,
              creator: response.data.creator_agent_id,
              created: response.data.created_timestamp,
              last_modified: response.data.last_modified,
              active_agents: response.data.active_users || [],
            };

            get().updateOrAddDocumentToList(documentInfo);

            // Return full document data including content
            return response.data;
          } else {
            console.error("DocumentStore: Failed to get document:", response.message);
            return null;
          }
        } catch (error) {
          console.error("Failed to get document:", error);
          return null;
        }
      },

      // Send edit operation
      sendEdit: async (
        documentId: string,
        operation: any,
        cursor?: { line: number; column: number }
      ) => {
        const { connection } = get();
        if (!connection || !documentId) {
          console.error("Cannot send edit: missing connection or documentId");
          return false;
        }

        try {
          console.log("DocumentStore: Sending edit operation:", operation);

          // Send document.edit event to backend
          const response = await connection.sendEvent({
            event_name: "document.edit",
            destination_id: "mod:openagents.mods.workspace.documents",
            payload: {
              document_id: documentId,
              operation: operation,
              cursor: cursor,
              version: 1, // TODO: Track version properly
            },
          });

          if (response.success) {
            console.log("DocumentStore: Edit sent successfully");
            return true;
          } else {
            console.error("DocumentStore: Failed to send edit:", response.message);
            return false;
          }
        } catch (error) {
          console.error("Failed to send edit:", error);
          return false;
        }
      },

      // Update cursor position
      updateCursor: async (
        documentId: string,
        line: number,
        column: number
      ) => {
        const { connection } = get();
        if (!connection || !documentId) {
          console.error("Cannot update cursor: missing connection or documentId");
          return false;
        }

        try {
          // Send document.update_cursor event to backend
          const response = await connection.sendEvent({
            event_name: "document.update_cursor",
            destination_id: "mod:openagents.mods.workspace.documents",
            payload: {
              document_id: documentId,
              line: line,
              column: column,
            },
          });

          if (response.success) {
            return true;
          } else {
            console.error("DocumentStore: Failed to update cursor:", response.message);
            return false;
          }
        } catch (error) {
          console.error("Failed to update cursor:", error);
          return false;
        }
      },

      // Leave document
      leaveDocument: async (documentId: string) => {
        const { connection } = get();
        if (!connection || !documentId) {
          console.error("Cannot leave document: missing connection or documentId");
          return false;
        }

        try {
          console.log("DocumentStore: Leaving document:", documentId);

          // Send document.leave event to backend
          const response = await connection.sendEvent({
            event_name: "document.leave",
            destination_id: "mod:openagents.mods.workspace.documents",
            payload: {
              document_id: documentId,
            },
          });

          if (response.success) {
            console.log("DocumentStore: Left document successfully");

            // Immediately update local active_agents list to remove current user
            const currentAgentId = connection.getAgentId();
            const document = get().documents.find(
              (doc) => doc.document_id === documentId
            );

            if (document && currentAgentId) {
              const updatedActiveAgents = document.active_agents.filter(
                (id) => id !== currentAgentId
              );
              console.log(
                `DocumentStore: Updating active_agents for ${documentId}, removing ${currentAgentId}`
              );
              get().updateDocument(documentId, {
                active_agents: updatedActiveAgents,
              });
            }

            return true;
          } else {
            console.error("DocumentStore: Failed to leave document:", response.message);
            return false;
          }
        } catch (error) {
          console.error("Failed to leave document:", error);
          return false;
        }
      },

      // Set connection
      setConnection: (connection: any | null) => {
        set({ connection });
      },

      // Setup event listeners
      setupEventListeners: () => {
        const { connection } = get();
        if (!connection) return;

        console.log("DocumentStore: Setting up document event listeners");

        // Document event handler
        const documentEventHandler = (event: any) => {
          // Handle document created event
          if (event.event_name === "document.created" && event.payload?.document) {
            console.log("DocumentStore: Received document.created event:", event);
            const doc = event.payload.document;

            // Convert backend data to DocumentInfo format
            const documentInfo: DocumentInfo = {
              document_id: doc.document_id,
              name: doc.name,
              creator: doc.creator_agent_id,
              created: doc.created_timestamp,
              last_modified: doc.last_modified,
              active_agents: doc.active_users || [],
            };

            console.log("DocumentStore: Adding document to list:", documentInfo);
            get().updateOrAddDocumentToList(documentInfo);
          }

          // Handle user entered document event
          if (event.event_name === "document.user_entered" && event.payload?.document) {
            console.log("DocumentStore: Received document.user_entered event:", event);
            const doc = event.payload.document;

            // Update document's active users list
            get().updateDocument(doc.document_id, {
              active_agents: doc.active_users || [],
            });
          }

          // Handle user left document event
          if (event.event_name === "document.user_left" && event.payload?.document) {
            console.log("DocumentStore: Received document.user_left event:", event);
            const doc = event.payload.document;

            // Update document's active users list
            get().updateDocument(doc.document_id, {
              active_agents: doc.active_users || [],
            });
          }

          // Handle document saved event
          if (event.event_name === "document.saved" && event.payload?.document) {
            console.log("DocumentStore: Received document.saved event:", event);
            // Event will be handled by MonacoCollaborativeEditor component
            // We emit a custom event that the component can listen to
            window.dispatchEvent(
              new CustomEvent("document-saved", {
                detail: event.payload,
              })
            );
          }

          // Handle cursor updated event
          if (event.event_name === "document.cursor_updated" && event.payload?.document) {
            console.log("DocumentStore: Received document.cursor_updated event:", event);
            // Event will be handled by MonacoCollaborativeEditor component
            window.dispatchEvent(
              new CustomEvent("document-cursor-updated", {
                detail: event.payload,
              })
            );
          }

          // Handle Yjs update event (for CRDT-based collaboration)
          if (event.event_name === "document.yjs_update" && event.payload) {
            console.log("DocumentStore: Received document.yjs_update event:", event);
            // Forward to YjsCollaborativeEditor via custom event
            window.dispatchEvent(
              new CustomEvent("document-yjs-update", {
                detail: {
                  document_id: event.payload.document_id,
                  update: event.payload.update,
                  source_agent_id: event.payload.source_agent_id,
                },
              })
            );
          }

          // Handle cursor update event (for Yjs-based editor)
          if (event.event_name === "document.cursor_update" && event.payload) {
            console.log("DocumentStore: Received document.cursor_update event:", event);
            // Forward to YjsCollaborativeEditor via custom event
            window.dispatchEvent(
              new CustomEvent("document-cursor-update", {
                detail: {
                  document_id: event.payload.document_id,
                  agent_id: event.payload.agent_id,
                  position: event.payload.position,
                },
              })
            );
          }
        };

        // Register to event router
        eventRouter.onDocumentEvent(documentEventHandler);

        // Save handler reference for cleanup
        set({ eventHandler: documentEventHandler });
      },

      // Cleanup event listeners
      cleanupEventListeners: () => {
        const { eventHandler } = get();

        console.log("DocumentStore: Cleaning up document event listeners");

        if (eventHandler) {
          eventRouter.offDocumentEvent(eventHandler);
          set({ eventHandler: null });
        }
      },

      // Update or add document to list
      updateOrAddDocumentToList: (document: DocumentInfo) => {
        set((state) => {
          const existingIndex = state.documents.findIndex(
            (doc) => doc.document_id === document.document_id
          );

          if (existingIndex >= 0) {
            // Update existing document
            const updatedDocuments = [...state.documents];
            updatedDocuments[existingIndex] = {
              ...updatedDocuments[existingIndex],
              ...document,
            };
            return { documents: updatedDocuments };
          } else {
            // Add new document
            return { documents: [...state.documents, document] };
          }
        });
      },
    }),
    {
      name: "openagents_documents", // localStorage key
      partialize: (state) => ({
        // Persist version number and basic state, don't persist document list (ensure all users see same default documents)
        version: state.version,
        threadState: state.threadState,
        // documents: state.documents, // Removed document list persistence, let all users see the same public documents
        selectedDocumentId: state.selectedDocumentId,
      }),
    }
  )
);

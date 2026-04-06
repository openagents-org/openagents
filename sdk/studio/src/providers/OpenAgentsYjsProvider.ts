/**
 * OpenAgentsYjsProvider - Custom Yjs provider for OpenAgents event system
 *
 * This provider connects Yjs documents to the OpenAgents event system,
 * allowing real-time collaborative editing without WebSocket.
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

export interface OpenAgentsConnection {
  sendEvent: (event: any) => Promise<any>;
}

export class OpenAgentsYjsProvider {
  private ydoc: Y.Doc;
  private connection: OpenAgentsConnection;
  private documentId: string;
  public awareness: Awareness;
  private isInitialized: boolean = false;
  private updateHandler: ((update: Uint8Array, origin: any) => void) | null = null;
  private eventListener: ((event: CustomEvent) => void) | null = null;

  constructor(
    ydoc: Y.Doc,
    connection: OpenAgentsConnection,
    documentId: string
  ) {
    this.ydoc = ydoc;
    this.connection = connection;
    this.documentId = documentId;
    this.awareness = new Awareness(ydoc);

    console.log('📡 [Yjs Provider] Initializing for document:', documentId);
    console.log('📡 [Yjs Provider] Y.Doc client ID:', ydoc.clientID);

    this.setupYjsListeners();
    this.setupEventListeners();
    this.setupAwarenessListeners();
    this.isInitialized = true;

    console.log('✅ [Yjs Provider] All listeners setup complete');
  }

  /**
   * Set up Yjs document listeners to send local updates
   */
  private setupYjsListeners() {
    this.updateHandler = (update: Uint8Array, origin: any) => {
      // Don't send updates that came from remote (avoid loops)
      if (origin === 'remote') {
        console.log('⏭️  [Yjs Update] Skipping remote-originated update');
        return;
      }

      console.log('📤 [Yjs Update → Backend] Sending local update', {
        size: update.length,
        documentId: this.documentId,
        origin: origin,
        clientID: this.ydoc.clientID
      });

      // Convert Uint8Array to regular array for JSON serialization
      const updateArray = Array.from(update);

      // Send through OpenAgents event system
      this.connection.sendEvent({
        event_name: 'document.yjs_update',
        destination_id: 'mod:openagents.mods.workspace.documents',
        payload: {
          document_id: this.documentId,
          update: updateArray,
        },
      }).catch((error) => {
        console.error('❌ Failed to send Yjs update:', error);
      });
    };

    this.ydoc.on('update', this.updateHandler);
  }

  /**
   * Set up event listeners to receive remote updates
   */
  private setupEventListeners() {
    this.eventListener = (event: CustomEvent) => {
      const { document_id, update } = event.detail;

      // Only process updates for this document
      if (document_id !== this.documentId) {
        console.log('⏭️  [Yjs Update] Ignoring update for different document:', document_id);
        return;
      }

      console.log('📥 [Yjs Update ← Backend] Received remote update', {
        size: update?.length,
        documentId: document_id,
        source_agent_id: event.detail.source_agent_id,
        myClientID: this.ydoc.clientID
      });

      if (!update || !Array.isArray(update)) {
        console.error('❌ Invalid update format:', update);
        return;
      }

      try {
        // Convert array back to Uint8Array
        const updateBytes = new Uint8Array(update);

        // Apply update with 'remote' origin to prevent echo
        Y.applyUpdate(this.ydoc, updateBytes, 'remote');

        console.log('✅ Yjs update applied successfully');
      } catch (error) {
        console.error('❌ Failed to apply Yjs update:', error);
      }
    };

    // Listen for Yjs updates from OpenAgents
    window.addEventListener('document-yjs-update', this.eventListener as EventListener);
  }

  /**
   * Set up awareness listeners to sync cursor positions
   */
  private setupAwarenessListeners() {
    // Listen for local awareness changes
    this.awareness.on('change', () => {
      const localState = this.awareness.getLocalState();

      if (localState && localState.cursor) {
        console.log('📍 Local awareness changed:', localState);

        // Send awareness update through OpenAgents
        this.connection.sendEvent({
          event_name: 'document.awareness_update',
          destination_id: 'mod:openagents.mods.workspace.documents',
          payload: {
            document_id: this.documentId,
            awareness_state: localState,
          },
        }).catch((error) => {
          console.error('❌ Failed to send awareness update:', error);
        });
      }
    });

    // Listen for remote awareness updates
    const awarenessListener = (event: CustomEvent) => {
      const { document_id, client_id, awareness_state } = event.detail;

      if (document_id !== this.documentId) return;

      console.log('📍 Received remote awareness update:', { client_id, awareness_state });

      // Update remote awareness state
      if (awareness_state) {
        this.awareness.setLocalStateField('clients', {
          ...(this.awareness.getLocalState()?.clients || {}),
          [client_id]: awareness_state,
        });
      }
    };

    window.addEventListener('document-awareness-update', awarenessListener as EventListener);
  }

  /**
   * Get the Awareness instance for MonacoBinding
   */
  getAwareness(): Awareness {
    return this.awareness;
  }

  /**
   * Initialize the document by fetching initial state from server
   */
  async initialize(initialContent?: string): Promise<void> {
    console.log('🔄 [Yjs Init] Starting initialization');

    const ytext = this.ydoc.getText('monaco');

    // STEP 1: Try to sync with server's Yjs state first (most up-to-date CRDT state)
    // This includes all edits from all users, even unsaved changes
    try {
      console.log('🔄 [Yjs Init] Attempting to sync from server Yjs state...');
      await this.syncWithServer();
      console.log('✅ [Yjs Init] Synced from server, document length:', ytext.length);
      return; // Successfully synced, we're done
    } catch (error) {
      console.warn('⚠️  [Yjs Init] Server Yjs sync failed, falling back to initialContent:', error);
    }

    // STEP 2: Fallback - only use initialContent if server sync failed
    // This happens when server has no Yjs state yet (e.g., first user to open the document)
    if (initialContent && ytext.length === 0) {
      console.log('📝 [Yjs Init] Initializing with fallback content, length:', initialContent.length);
      this.ydoc.transact(() => {
        ytext.insert(0, initialContent);
      }, 'init');
      console.log('✅ [Yjs Init] Initialized with fallback content');
    }

    console.log('✅ [Yjs Init] Initialization complete, document length:', ytext.length);
  }

  /**
   * Get the Yjs text object for Monaco binding
   */
  getText(): Y.Text {
    return this.ydoc.getText('monaco');
  }

  /**
   * Sync with server - request full document state
   */
  async syncWithServer(): Promise<void> {
    console.log('🔄 [Yjs Sync] Requesting full document state from server');

    try {
      const response = await this.connection.sendEvent({
        event_name: 'document.yjs_sync',
        destination_id: 'mod:openagents.mods.workspace.documents',
        payload: {
          document_id: this.documentId,
        },
      });

      console.log('🔄 [Yjs Sync] Server response:', response);

      if (response.success && response.data?.yjs_state) {
        console.log('📥 [Yjs Sync] Applying state from server, size:', response.data.yjs_state.length);
        const state = new Uint8Array(response.data.yjs_state);
        Y.applyUpdate(this.ydoc, state, 'remote');
        console.log('✅ [Yjs Sync] State applied successfully');
      } else {
        throw new Error(response.message || 'No Yjs state returned from server');
      }
    } catch (error) {
      console.error('❌ [Yjs Sync] Failed to sync with server:', error);
      throw error;
    }
  }

  /**
   * Clean up listeners and connections
   */
  destroy() {
    console.log('🛑 Destroying OpenAgentsYjsProvider');

    if (this.updateHandler) {
      this.ydoc.off('update', this.updateHandler);
    }

    if (this.eventListener) {
      window.removeEventListener('document-yjs-update', this.eventListener as EventListener);
    }

    this.isInitialized = false;
  }

  /**
   * Check if provider is connected and ready
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get current document content as plain text
   */
  getContent(): string {
    const ytext = this.ydoc.getText('monaco');
    return ytext.toString();
  }
}

export default OpenAgentsYjsProvider;

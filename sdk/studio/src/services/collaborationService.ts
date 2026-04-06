import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as awarenessProtocol from 'y-protocols/awareness';
import { RETRY_CONFIG, NETWORK_CONFIG } from '@/constants/appConfig';
import { collaborationLogger } from '@/utils/logger';

// User information interface
export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  cursor?: {
    line: number;
    column: number;
  };
}

// Connection status enumeration
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting'
}

// Collaboration service class
export class CollaborationService {
  private ydoc: Y.Doc;
  private provider: WebsocketProvider;
  private ytext: Y.Text;
  private awareness: awarenessProtocol.Awareness;
  private userId: string;
  private roomName: string;
  private websocketUrl: string;
  private userName?: string;

  // Event callbacks
  private onStatusChange?: (status: ConnectionStatus) => void;
  private onUsersChange?: (users: CollaborationUser[]) => void;
  private onCursorChange?: (userId: string, user: CollaborationUser) => void;
  private onContentChange?: (content: string) => void;
  private onError?: (error: Error) => void;

  // State
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private users: Map<string, CollaborationUser> = new Map();
  private retryCount = 0;
  private maxRetries = RETRY_CONFIG.MAX_RETRY_ATTEMPTS;
  private retryDelay = RETRY_CONFIG.INITIAL_RETRY_DELAY;

  // User color pool
  private static COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
    '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43',
    '#10AC84', '#EE5A24', '#0652DD', '#9C88FF', '#FFC312'
  ];
  private static colorIndex = 0;

  constructor(
    roomName: string,
    userId?: string,
    websocketUrl: string = 'ws://localhost:1234',
    userName?: string
  ) {
    this.roomName = roomName;
    this.userId = userId || this.generateUserId();
    this.websocketUrl = websocketUrl;
    this.userName = userName;

    collaborationLogger.debug('🔧 [CollaborationService] Initializing service...');
    collaborationLogger.debug('   🏠 Room:', roomName);
    collaborationLogger.debug('   👤 User ID:', this.userId);
    collaborationLogger.debug('   🌐 WebSocket:', websocketUrl);

    // Create Yjs document
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('monaco');

    // Initialize WebSocket provider
    this.provider = new WebsocketProvider(
      this.websocketUrl,
      this.roomName,
      this.ydoc
    );

    collaborationLogger.debug('🔌 [CollaborationService] WebSocket provider created');

    // Get awareness instance
    this.awareness = this.provider.awareness;

    this.setupEventListeners();
  }

  // Generate user ID
  private generateUserId(): string {
    return `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // Get user color
  private getUserColor(): string {
    const color = CollaborationService.COLORS[CollaborationService.colorIndex % CollaborationService.COLORS.length];
    CollaborationService.colorIndex++;
    return color;
  }

  // Generate user name
  private generateUserName(): string {
    const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
    const adjectives = ['Creative', 'Smart', 'Friendly', 'Bold', 'Clever', 'Bright', 'Quick', 'Wise'];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${names[Math.floor(Math.random() * names.length)]}`;
  }

  // Set up event listeners
  private setupEventListeners() {
    collaborationLogger.debug('👂 [CollaborationService] Setting up event listeners...');

    // Connection status listener
    this.provider.on('status', (event: { status: string }) => {
      const prevStatus = this.connectionStatus;
      collaborationLogger.debug(`📡 [CollaborationService] Provider status event:`, event.status);

      switch (event.status) {
        case 'connecting':
          this.connectionStatus = ConnectionStatus.CONNECTING;
          collaborationLogger.debug('🔄 [CollaborationService] Connecting to server...');
          break;
        case 'connected':
          this.connectionStatus = ConnectionStatus.CONNECTED;
          this.retryCount = 0;
          collaborationLogger.debug('✅ [CollaborationService] Connected to server!');

          // Set local user information
          const userName = this.userName || this.generateUserName();
          const userColor = this.getUserColor();
          this.awareness.setLocalStateField('user', {
            id: this.userId,
            name: userName,
            color: userColor
          });
          collaborationLogger.debug(`👤 [CollaborationService] User registered: ${userName} (${userColor})`);
          break;
        case 'disconnected':
          this.connectionStatus = ConnectionStatus.DISCONNECTED;
          collaborationLogger.debug('❌ [CollaborationService] Disconnected from server');
          this.handleDisconnection();
          break;
      }

      if (prevStatus !== this.connectionStatus) {
        collaborationLogger.debug(`🔗 [CollaborationService] Connection status changed: ${prevStatus} → ${this.connectionStatus}`);
        this.onStatusChange?.(this.connectionStatus);
      }
    });

    // Awareness change listener
    this.awareness.on('change', () => {
      collaborationLogger.debug('👥 [CollaborationService] Awareness changed, updating users...');
      this.updateUsersFromAwareness();
    });

    // Document change listener
    this.ytext.observe((event) => {
      const content = this.ytext.toString();
      collaborationLogger.debug('📝 [CollaborationService] Document content changed, length:', content.length);
      this.onContentChange?.(content);
    });

    // WebSocket error handling
    this.provider.ws?.addEventListener('error', (error) => {
      collaborationLogger.error('🔴 WebSocket error:', error);
      this.onError?.(new Error('WebSocket connection error'));
    });

    // WebSocket close handling
    this.provider.ws?.addEventListener('close', (event) => {
      collaborationLogger.debug('🔌 WebSocket closed:', event.code, event.reason);
      if (!event.wasClean) {
        this.handleDisconnection();
      }
    });
  }

  // Update user list from awareness
  private updateUsersFromAwareness() {
    const users: CollaborationUser[] = [];

    this.awareness.getStates().forEach((state, clientId) => {
      if (state.user) {
        const user: CollaborationUser = {
          id: state.user.id || `client-${clientId}`,
          name: state.user.name || `User ${clientId}`,
          color: state.user.color || '#666666',
          cursor: state.cursor
        };
        users.push(user);
        this.users.set(user.id, user);

        // Trigger cursor update callback
        if (state.cursor && clientId !== this.awareness.clientID) {
          this.onCursorChange?.(user.id, user);
        }
      }
    });

    this.onUsersChange?.(users);
  }


  // Handle disconnection
  private handleDisconnection() {
    if (this.retryCount < this.maxRetries) {
      this.connectionStatus = ConnectionStatus.RECONNECTING;
      this.onStatusChange?.(this.connectionStatus);

      this.retryCount++;
      const delay = this.retryDelay * Math.pow(2, this.retryCount - 1); // Exponential backoff

      collaborationLogger.debug(`🔄 Attempting to reconnect (${this.retryCount}/${this.maxRetries}) in ${delay}ms`);

      setTimeout(() => {
        this.reconnect();
      }, delay);
    } else {
      collaborationLogger.error('🔴 Max reconnection attempts reached');
      this.onError?.(new Error('Failed to reconnect after multiple attempts'));
    }
  }

  // Reconnect
  private reconnect() {
    try {
      this.provider.disconnect();
      this.provider = new WebsocketProvider(
        this.websocketUrl,
        this.roomName,
        this.ydoc,
        {
          params: {
            userId: this.userId
          }
        }
      );
      this.setupEventListeners();
    } catch (error) {
      collaborationLogger.error('🔴 Reconnection failed:', error);
      this.handleDisconnection();
    }
  }

  // Send cursor position
  public updateCursor(line: number, column: number) {
    try {
      this.awareness.setLocalStateField('cursor', { line, column });
    } catch (error) {
      collaborationLogger.error('🔴 Failed to update cursor:', error);
    }
  }

  // Send heartbeat (no longer needed, awareness handles automatically)
  public sendHeartbeat() {
    // No-op - awareness handles heartbeat automatically
  }

  // Get document content
  public getContent(): string {
    return this.ytext.toString();
  }

  // Set document content (used during initialization)
  public setInitialContent(content: string) {
    if (this.ytext.length === 0 && content) {
      this.ytext.insert(0, content);
    }
  }

  // Get current user information
  public getCurrentUser(): CollaborationUser | null {
    return this.users.get(this.userId) || null;
  }

  // Get all users
  public getUsers(): CollaborationUser[] {
    return Array.from(this.users.values());
  }

  // Get connection status
  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  // Get Yjs document and text object
  public getYDoc(): Y.Doc {
    return this.ydoc;
  }

  public getYText(): Y.Text {
    return this.ytext;
  }

  // Event callback settings
  public onConnectionStatusChange(callback: (status: ConnectionStatus) => void) {
    this.onStatusChange = callback;
  }

  public onUsersUpdate(callback: (users: CollaborationUser[]) => void) {
    this.onUsersChange = callback;
  }

  public onCursorUpdate(callback: (userId: string, user: CollaborationUser) => void) {
    this.onCursorChange = callback;
  }

  public onContentUpdate(callback: (content: string) => void) {
    this.onContentChange = callback;
  }

  public onErrorOccurred(callback: (error: Error) => void) {
    this.onError = callback;
  }

  // Clean up resources
  public destroy() {
    try {
      // Clean up event listeners
      this.onStatusChange = undefined;
      this.onUsersChange = undefined;
      this.onCursorChange = undefined;
      this.onContentChange = undefined;
      this.onError = undefined;

      // Clear awareness local state
      this.awareness.setLocalState(null);

      // Disconnect
      this.provider.disconnect();

      // Destroy document
      this.ydoc.destroy();

      collaborationLogger.debug('🧹 Collaboration service destroyed');
    } catch (error) {
      collaborationLogger.error('🔴 Error destroying collaboration service:', error);
    }
  }
}

// Service factory function
export function createCollaborationService(
  documentId: string,
  userId?: string,
  serverUrl?: string
): CollaborationService {
  return new CollaborationService(
    `document-${documentId}`,
    userId,
    serverUrl
  );
}

// Export constants
export const DEFAULT_WEBSOCKET_URL = 'ws://localhost:1234';
export const HEARTBEAT_INTERVAL = NETWORK_CONFIG.HEARTBEAT_INTERVAL;
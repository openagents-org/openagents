/**
 * OpenAgents Network Service
 * Handles WebSocket connections to OpenAgents networks and thread messaging mod integration
 */

import { NetworkConnection } from './networkService';

export interface OpenAgentsNetworkInfo {
  name: string;
  node_id: string;
  mode: 'centralized' | 'decentralized';
  mods: string[];
  agent_count: number;
}

export interface ThreadMessagingChannel {
  name: string;
  description: string;
  agents: string[];
  message_count: number;
  thread_count: number;
}

export interface ThreadMessage {
  message_id: string;
  sender_id: string;
  timestamp: string;
  content: {
    text: string;
  };
  message_type: 'direct_message' | 'channel_message' | 'reply_message';
  channel?: string;
  target_agent_id?: string;
  reply_to_id?: string;
  thread_level?: number;
  quoted_message_id?: string;
  quoted_text?: string;
  thread_info?: {
    is_root: boolean;
    thread_level?: number;
    children_count?: number;
  };
  reactions?: {
    [reaction_type: string]: number;
  };
}

export interface AgentInfo {
  agent_id: string;
  metadata: {
    display_name?: string;
    avatar?: string;
    status?: 'online' | 'offline' | 'away';
  };
  last_activity: string;
}

export class OpenAgentsConnection {
  private websocket: WebSocket | null = null;
  private agentId: string;
  private originalAgentId: string;
  private networkConnection: NetworkConnection;
  private messageHandlers: Map<string, (message: any) => void> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private connected = false;
  private isConnecting = false;
  private connectionAborted = false;
  private messageQueue: any[] = [];
  private sendTimeout: NodeJS.Timeout | null = null;
  private lastModCheck = 0;
  private modCheckCooldown = 5000; // 5 seconds cooldown between mod checks

  constructor(agentId: string, networkConnection: NetworkConnection) {
    this.agentId = agentId;
    this.originalAgentId = agentId;
    this.networkConnection = networkConnection;
  }

  private generateUniqueAgentId(baseId: string, attempt: number = 1): string {
    if (attempt === 1) {
      return `${baseId}_${Date.now()}`;
    }
    return `${baseId}_${Date.now()}_${attempt}`;
  }

  async connect(retryWithUniqueId: boolean = true): Promise<boolean> {
    try {
      // Prevent concurrent connections
      if (this.isConnecting) {
        console.log('⚠️ Connection attempt ignored - already connecting');
        return false;
      }
      
      // Reset connection state
      this.connectionAborted = false;
      this.isConnecting = true;
      
      // Close any existing connection
      if (this.websocket) {
        this.websocket.close();
        this.websocket = null;
      }
      
      // Auto-detect secure WebSocket based on current page protocol
      const isSecure = window.location.protocol === 'https:';
      const protocol = isSecure ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${this.networkConnection.host}:${this.networkConnection.port}`;
      
      console.log(`🔌 Attempting WebSocket connection...`);
      console.log(`📍 Page URL: ${window.location.href}`);
      console.log(`🌐 Target: ${wsUrl}`);
      console.log(`🔒 Secure: ${isSecure}`);
      console.log(`👤 Agent: ${this.agentId}`);

      this.websocket = new WebSocket(wsUrl);

      return new Promise((resolve, reject) => {
        if (!this.websocket) {
          reject(new Error('Failed to create WebSocket'));
          return;
        }

        this.websocket.onopen = () => {
          if (this.connectionAborted) {
            console.log('🔌 Connection aborted during handshake');
            return;
          }
          
          console.log('WebSocket connected, registering agent...');
          // Only force reconnect on the first attempt, not on reconnections
          const shouldForceReconnect = this.reconnectAttempts === 0;
          this.registerAgent(shouldForceReconnect).then(() => {
            if (this.connectionAborted) {
              console.log('🔌 Registration completed but connection was aborted');
              return;
            }
            
            this.connected = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            resolve(true);
          }).catch(async (error) => {
            if (this.connectionAborted) {
              console.log('🔌 Registration failed but connection was aborted');
              return;
            }
            
            // If agent already connected and we can retry with unique ID
            if (retryWithUniqueId && error.message.includes('already connected')) {
              console.log('Agent ID conflict detected, trying with unique ID...');
              this.agentId = this.generateUniqueAgentId(this.originalAgentId);
              
              try {
                // Don't force reconnect when retrying with new agent ID
                await this.registerAgent(false);
                if (!this.connectionAborted) {
                  this.connected = true;
                  this.isConnecting = false;
                  this.reconnectAttempts = 0;
                  console.log(`Successfully registered with unique ID: ${this.agentId}`);
                  resolve(true);
                }
              } catch (retryError) {
                this.isConnecting = false;
                reject(retryError);
              }
            } else {
              this.isConnecting = false;
              reject(error);
            }
          });
        };

        this.websocket.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.websocket.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          console.log('Close event details:', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            readyState: this.websocket?.readyState
          });
          
          this.isConnecting = false;
          
          // If connection was never established, treat as connection error
          if (!this.connected && event.code !== 1000 && !this.connectionAborted) {
            reject(new Error(`WebSocket connection failed. Code: ${event.code}, Reason: ${event.reason || 'Unknown'}`));
            return;
          }
          
          this.connected = false;
          
          // Don't auto-reconnect if connection was manually aborted
          if (this.connectionAborted) {
            console.log('🔌 Connection was manually aborted, skipping reconnect');
            return;
          }
          
          // Auto-reconnect with proper safeguards
          this.handleReconnect();
        };

        this.websocket.onerror = (error) => {
          console.error('WebSocket error:', error);
          console.error('WebSocket readyState:', this.websocket?.readyState);
          console.error('WebSocket URL:', this.websocket?.url);
          this.isConnecting = false;
          if (!this.connectionAborted) {
            reject(new Error(`WebSocket connection failed to ${wsUrl}. Check if the server is accessible and not blocked by firewall/proxy.`));
          }
        };

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!this.connected && !this.connectionAborted) {
            this.isConnecting = false;
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      });
    } catch (error) {
      this.isConnecting = false;
      console.error('Failed to connect to OpenAgents network:', error);
      throw error;
    }
  }

  private async registerAgent(forceReconnect: boolean = true): Promise<void> {
    console.log(`🔧 Registering agent with force_reconnect: ${forceReconnect} (reconnect attempts: ${this.reconnectAttempts})`);
    
    return new Promise((resolve, reject) => {
      const registrationMessage = {
        type: 'system_request',
        command: 'register_agent',
        data: {
          agent_id: this.agentId,
          force_reconnect: forceReconnect,
          metadata: {
            display_name: this.agentId,
            status: 'online',
            capabilities: ['thread_messaging']
          }
        }
      };

      // Listen for registration response
      const handleRegistration = (data: any) => {
        if (data.type === 'system_response' && data.command === 'register_agent') {
          if (data.success) {
            console.log('Agent registered successfully:', data.network_name);
            this.messageHandlers.delete('registration');
            resolve();
          } else {
            const errorMsg = data.error || 'Registration failed';
            console.error('Agent registration failed:', errorMsg);
            
            // If agent ID already exists and we haven't tried force reconnect, suggest solutions
            if (errorMsg.includes('already connected') && forceReconnect) {
              console.log('Agent already connected despite force_reconnect=true');
            }
            
            this.messageHandlers.delete('registration');
            reject(new Error(errorMsg));
          }
        }
      };

      this.messageHandlers.set('registration', handleRegistration);
      this.sendMessage(registrationMessage);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.messageHandlers.has('registration')) {
          this.messageHandlers.delete('registration');
          reject(new Error('Registration timeout'));
        }
      }, 5000);
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      console.log('📨 Received message:', message);
      
      // Handle system responses first
      if (message.type === 'system_response') {
        console.log('🔧 System response:', message);
        // Call specific handlers for system responses
        this.messageHandlers.forEach((handler, key) => {
          // Call handlers for registration, list_mods, list_agents, get_network_info, etc.
          if (key === 'registration' || 
              key.startsWith('list_mods_') || 
              key.startsWith('list_agents_') ||
              key.startsWith('get_network_info_') ||
              key.startsWith('network_info_')) {
            handler(message);
          }
        });
        return;
      }

      // Handle wrapped messages (type: 'message' with data field)
      if (message.type === 'message' && message.data) {
        console.log('📦 Unwrapping message data:', message.data);
        const innerMessage = message.data;
        
        // Check if inner message is a mod message
        if (innerMessage.message_type === 'mod_message') {
          console.log('📬 Mod message received (unwrapped):', innerMessage);
          
          // Check mod field in payload first, then top level
          const modField = innerMessage.payload?.mod || innerMessage.mod || innerMessage.mod_name;
          console.log('🔍 Mod field from payload:', innerMessage.payload?.mod, 'top level mod:', innerMessage.mod);
          
          if (modField === 'openagents.mods.communication.thread_messaging' || 
              modField === 'thread_messaging') {
            console.log('✅ Processing thread messaging mod message');
            
            // Use payload.content if available, otherwise use content
            const messageToProcess = {
              ...innerMessage,
              content: innerMessage.payload?.content || innerMessage.content,
              mod: modField
            };
            
            this.handleThreadMessage(messageToProcess);
          } else if (modField === 'openagents.mods.work.shared_document' || 
                     modField === 'shared_document') {
            console.log('✅ Processing shared document mod message');
            
            // Use payload.content if available, otherwise use content
            const messageToProcess = {
              ...innerMessage,
              content: innerMessage.payload?.content || innerMessage.content,
              mod: modField
            };
            
            this.handleSharedDocumentMessage(messageToProcess);
          } else {
            console.log('⚠️ Mod message for different mod:', modField);
          }
        }
        return;
      }

      // Handle direct mod messages (not wrapped)
      if (message.type === 'mod_message') {
        console.log('📬 Mod message received:', message);
        console.log('🔍 Mod field:', message.mod, 'mod_name field:', message.mod_name);
        if (message.mod === 'openagents.mods.communication.thread_messaging' || 
            message.mod === 'thread_messaging' || 
            message.mod_name === 'thread_messaging') {
          console.log('✅ Processing thread messaging mod message');
          this.handleThreadMessage(message);
        } else if (message.mod === 'openagents.mods.work.shared_document' || 
                   message.mod === 'shared_document' || 
                   message.mod_name === 'shared_document') {
          console.log('✅ Processing shared document mod message');
          this.handleSharedDocumentMessage(message);
        } else {
          console.log('⚠️ Mod message for different mod:', message.mod || message.mod_name);
        }
      }

      // Handle heartbeats
      if (message.type === 'heartbeat') {
        this.sendMessage({ 
          type: 'heartbeat_response',
          sender_id: this.agentId 
        });
      }

    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }

  private handleThreadMessage(message: any): void {
    // Emit events for different message types
    const content = message.content;
    
    console.log('📥 Thread message received:', message);
    console.log('📋 Content:', content);
    console.log('🔍 Action/Type:', content.action || content.message_type);
    
    // Handle both action and message_type fields
    const actionType = content.action || content.message_type;
    
    switch (actionType) {
      case 'message_received':
        this.emit('message', content.message);
        break;
      case 'channel_messages_retrieved':
      case 'retrieve_channel_messages_response':
        console.log('📥 Channel messages retrieved:', content);
        this.emit('channel_messages', content);
        break;
      case 'direct_messages_retrieved':
      case 'retrieve_direct_messages_response':
        console.log('📥 Direct messages retrieved:', content);
        this.emit('direct_messages', content);
        break;
      case 'channels_list':
      case 'channel_info_response':
      case 'list_channels_response':
        console.log('📋 Emitting channels:', content.channels);
        this.emit('channels', content.channels || []);
        break;
      case 'reaction_notification':
        this.emit('reaction', content);
        break;
      case 'file_upload_complete':
        this.emit('file_uploaded', content);
        break;
      default:
        console.log('🤔 Unhandled action type:', actionType, 'Content:', content);
        break;
    }
  }

  private handleSharedDocumentMessage(message: any): void {
    // Handle shared document mod messages
    const content = message.content;
    
    console.log('📄 Shared document message received:', message);
    console.log('📋 Content:', content);
    console.log('🔍 Action/Type:', content.action || content.message_type);
    
    // Handle both action and message_type fields
    const actionType = content.action || content.message_type;
    
    // Check if this is a response to a specific request
    const requestId = message.request_id || content.request_id;
    console.log('🔍 Debug - message.request_id:', message.request_id);
    console.log('🔍 Debug - content.request_id:', content.request_id);
    console.log('🔍 Debug - final requestId:', requestId);
    console.log('🔍 Debug - available handlers:', Array.from(this.messageHandlers.keys()));
    
    if (requestId) {
      console.log('📨 Processing response for request ID:', requestId);
      const handler = this.messageHandlers.get(requestId);
      if (handler) {
        console.log('✅ Found handler for request ID:', requestId);
        this.messageHandlers.delete(requestId);
        handler(content);
        return;
      } else {
        console.log('⚠️ No handler found for request ID:', requestId);
      }
    } else {
      console.log('⚠️ No request ID found in message');
      
      // Special handling for document_content_response without request_id
      // Try to match document responses without request_id
      if (actionType === 'document_content_response' || actionType === 'document_operation_response') {
        console.log(`🔧 Attempting to match ${actionType} without request_id`);
        console.log('🔧 Current handlers:', Array.from(this.messageHandlers.keys()));
        
        const contentHandlers = Array.from(this.messageHandlers.entries())
          .filter(([key]) => key.match(/(open_document_|get_document_content_)/));
        
        console.log('🔧 Matching content handlers:', contentHandlers.map(([key]) => key));
        
        if (contentHandlers.length > 0) {
          // Sort by timestamp (most recent first) to match the most recent request
          const sortedHandlers = contentHandlers.sort(([keyA], [keyB]) => {
            const timestampA = parseInt(keyA.split('_').pop() || '0');
            const timestampB = parseInt(keyB.split('_').pop() || '0');
            return timestampB - timestampA;
          });
          
          const [handlerKey, handler] = sortedHandlers[0];
          console.log(`✅ Found pending content handler for ${actionType}:`, handlerKey);
          console.log(`🗑️ Removing handler:`, handlerKey);
          this.messageHandlers.delete(handlerKey);
          console.log(`📊 Handlers remaining:`, this.messageHandlers.size);
          handler(content);
          return;
        } else {
          console.log(`⚠️ No pending content handlers found for ${actionType}`);
        }
      }
    }
    
    // Handle general shared document events
    switch (actionType) {
      case 'document_list':
      case 'document_list_response':
      case 'list_documents_response':
        console.log('📋 Document list received:', content);
        // Also try to match with pending list_documents requests
        const listDocsHandlers = Array.from(this.messageHandlers.entries())
          .filter(([key]) => key.startsWith('list_documents_'));
        if (listDocsHandlers.length > 0) {
          const [handlerKey, handler] = listDocsHandlers[0];
          console.log('✅ Found pending list_documents handler:', handlerKey);
          this.messageHandlers.delete(handlerKey);
          handler(content);
        } else {
          this.emit('documents_list', content);
        }
        break;
      case 'document_created':
        console.log('📄 Document created:', content);
        this.emit('document_created', content);
        break;
      case 'document_content_response':
        console.log('📄 Document content received:', content);
        // This is handled by request_id matching above, so this case should not be reached
        console.log('⚠️ document_content_response reached switch case - this should be handled by request_id matching');
        this.emit('document_content', content);
        break;
      case 'document_updated':
        console.log('📝 Document updated:', content);
        this.emit('document_updated', content);
        break;
      case 'document_deleted':
        console.log('🗑️ Document deleted:', content);
        this.emit('document_deleted', content);
        break;
      case 'document_content':
      case 'get_document_content_response':
        console.log('📄 Document content received:', content);
        this.emit('document_content', content);
        break;
      case 'document_operation_response':
        console.log('⚙️ Document operation response received:', content);
        // Try to match with pending document operation requests (create, open, insert, remove, etc.)
        // Also include get_document_content_ since server sometimes sends operation_response for content requests
        const operationHandlers = Array.from(this.messageHandlers.entries())
          .filter(([key]) => key.match(/(create_document_|open_document_|close_document_|insert_lines_|remove_lines_|replace_lines_|add_comment_|remove_comment_|get_document_content_)/));
        if (operationHandlers.length > 0) {
          console.log('🔧 Available operation handlers:', operationHandlers.map(([key]) => key));
          // Sort by timestamp (most recent first) for better matching
          const sortedHandlers = operationHandlers.sort(([keyA], [keyB]) => {
            const timestampA = parseInt(keyA.split('_').pop() || '0');
            const timestampB = parseInt(keyB.split('_').pop() || '0');
            return timestampB - timestampA;
          });
          const [handlerKey, handler] = sortedHandlers[0];
          console.log('✅ Found pending operation handler:', handlerKey);
          console.log('🎯 Calling handler for document_operation_response');
          console.log(`🗑️ Removing operation handler:`, handlerKey);
          this.messageHandlers.delete(handlerKey);
          console.log(`📊 Handlers remaining after operation:`, this.messageHandlers.size);
          handler(content);
        } else {
          this.emit('document_operation', content);
        }
        break;
      case 'document_history_response':
        console.log('📜 Document history response received:', content);
        this.emit('document_history', content);
        break;
      case 'agent_presence_response':
        console.log('👥 Agent presence response received:', content);
        this.emit('agent_presence', content);
        break;
      default:
        console.log('🤔 Unhandled shared document action type:', actionType, 'Content:', content);
        break;
    }
  }

  private emit(event: string, data: any): void {
    const handler = this.messageHandlers.get(event);
    if (handler) {
      handler(data);
    }
  }

  private handleReconnect(): void {
    // Don't reconnect if connection was manually aborted
    if (this.connectionAborted) {
      console.log('🔄 Connection was manually aborted, skipping reconnect');
      return;
    }

    // Don't reconnect if already connecting
    if (this.isConnecting) {
      console.log('🔄 Already attempting to reconnect, skipping');
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`🔄 Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      // Emit reconnecting event
      this.emit('reconnecting', { attempt: this.reconnectAttempts, maxAttempts: this.maxReconnectAttempts, delay });
      
      setTimeout(async () => {
        // Check again if we should still reconnect
        if (this.connectionAborted || this.connected) {
          return;
        }

        try {
          console.log(`🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          const success = await this.connect();
          
          if (success) {
            console.log('🔄 ✅ Reconnection successful!');
            this.emit('reconnected', { attempts: this.reconnectAttempts });
          } else {
            console.log('🔄 ❌ Reconnection failed, will retry...');
            this.handleReconnect(); // Try again
          }
        } catch (error) {
          console.log(`🔄 ❌ Reconnection attempt ${this.reconnectAttempts} failed:`, error);
          this.handleReconnect(); // Try again
        }
      }, delay);
    } else {
      console.log(`🔄 Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      this.emit('connectionLost', { reason: 'Max reconnection attempts reached' });
    }
  }

  private sendMessage(message: any): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      // Ensure sender_id is present for all non-system messages
      if (message.type !== 'system_request' && message.type !== 'heartbeat_response') {
        if (!message.sender_id) {
          message.sender_id = this.agentId;
        }
      }
      
      // For heartbeat responses, ensure sender_id is present
      if (message.type === 'heartbeat_response' && !message.sender_id) {
        message.sender_id = this.agentId;
      }
      
      console.log('📤 Sending message:', JSON.stringify(message, null, 2));
      this.websocket.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: WebSocket not connected', {
        readyState: this.websocket?.readyState,
        isConnecting: this.isConnecting,
        connectionAborted: this.connectionAborted
      });
    }
  }

  // Thread Messaging API Methods

  on(event: string, handler: (data: any) => void): void {
    this.messageHandlers.set(event, handler);
  }

  off(event: string): void {
    this.messageHandlers.delete(event);
  }

  async getNetworkInfo(): Promise<OpenAgentsNetworkInfo> {
    return new Promise((resolve, reject) => {
      const requestId = `network_info_${Date.now()}`;
      
      const handler = (data: any) => {
        if (data.type === 'system_response' && data.request_id === requestId) {
          this.messageHandlers.delete(requestId);
          if (data.success) {
            resolve(data.network_info);
          } else {
            reject(new Error(data.error));
          }
        }
      };

      this.messageHandlers.set(requestId, handler);
      this.sendMessage({
        type: 'system_request',
        command: 'get_network_info',
        data: {
          request_id: requestId,
          agent_id: this.agentId
        }
      });

      setTimeout(() => {
        this.messageHandlers.delete(requestId);
        reject(new Error('Network info request timeout'));
      }, 5000);
    });
  }

  async listNetworkMods(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const requestId = `list_mods_${Date.now()}`;
      let isResolved = false;
      
      const handler = (data: any) => {
        console.log('📥 Received response for list_mods:', data);
        // Check if this is the response for our specific request
        if (data.type === 'system_response' && 
            data.command === 'list_mods' && 
            (data.request_id === requestId || !data.request_id) && // Accept responses with or without request_id
            !isResolved) {
          
          // Remove the handler immediately to prevent duplicate calls
          this.messageHandlers.delete(requestId);
          isResolved = true;
          
          if (data.success) {
            console.log('✅ Mods list received:', data.mods);
            resolve(data.mods || []);
          } else {
            console.error('❌ Mods list error:', data.error);
            reject(new Error(data.error));
          }
        }
      };

      this.messageHandlers.set(requestId, handler);
      
      console.log('📤 Sending list_mods request with ID:', requestId);
      this.sendMessage({
        type: 'system_request',
        command: 'list_mods',
        data: {
          request_id: requestId,
          agent_id: this.agentId
        }
      });

      setTimeout(() => {
        if (!isResolved) {
          this.messageHandlers.delete(requestId);
          isResolved = true;
          console.warn('⏰ List mods request timeout for ID:', requestId);
          reject(new Error('List mods request timeout'));
        }
      }, 5000);
    });
  }

  async listNetworkAgents(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const requestId = `list_agents_${Date.now()}`;
      let isResolved = false;
      
      const handler = (data: any) => {
        console.log('📥 Received response for list_agents:', data);
        // Check if this is the response for our specific request
        if (data.type === 'system_response' && 
            data.command === 'list_agents' && 
            (data.request_id === requestId || !data.request_id) && // Accept responses with or without request_id
            !isResolved) {
          
          // Remove the handler immediately to prevent duplicate calls
          this.messageHandlers.delete(requestId);
          isResolved = true;
          
          if (data.success) {
            console.log('✅ Agents list received:', data.agents);
            resolve(data.agents || []);
          } else {
            console.error('❌ Agents list error:', data.error);
            reject(new Error(data.error));
          }
        }
      };

      this.messageHandlers.set(requestId, handler);
      
      console.log('📤 Sending list_agents request with ID:', requestId);
      this.sendMessage({
        type: 'system_request',
        command: 'list_agents',
        data: {
          request_id: requestId,
          agent_id: this.agentId
        }
      });

      setTimeout(() => {
        if (!isResolved) {
          this.messageHandlers.delete(requestId);
          isResolved = true;
          console.warn('⏰ List agents request timeout for ID:', requestId);
          reject(new Error('List agents request timeout'));
        }
      }, 5000);
    });
  }

  async hasThreadMessagingMod(): Promise<boolean> {
    try {
      // Rate limiting: prevent excessive mod checks
      const now = Date.now();
      if (now - this.lastModCheck < this.modCheckCooldown) {
        console.log('🚫 Mod check rate limited, skipping...');
        return false;
      }
      this.lastModCheck = now;

      console.log('🔍 Checking for thread messaging mod...');
      const mods = await this.listNetworkMods();
      console.log('📋 Available network mods:', mods);
      console.log('📋 Mods array type:', typeof mods, 'length:', mods?.length);
      
      if (!Array.isArray(mods)) {
        console.warn('⚠️ Mods response is not an array:', mods);
        return false;
      }
      
      // Handle both string arrays and mod info objects
      const modNames = mods.map((mod: any) => {
        if (typeof mod === 'string') {
          return mod;
        } else if (typeof mod === 'object' && mod !== null && mod.name) {
          return mod.name;
        }
        return null;
      }).filter(Boolean);
      
      console.log('🔧 Extracted mod names:', modNames);
      
      const hasThreadMod = modNames.includes('thread_messaging') || 
                          modNames.includes('openagents.mods.communication.thread_messaging');
      
      console.log('✅ Thread messaging mod detected:', hasThreadMod);
      console.log('🔍 Looking for:', ['thread_messaging', 'openagents.mods.communication.thread_messaging']);
      console.log('📋 Found mods:', mods);
      
      return hasThreadMod;
    } catch (error) {
      console.error('❌ Failed to check for thread messaging mod:', error);
      return false;
    }
  }

  async hasSharedDocumentMod(): Promise<boolean> {
    try {
      // Rate limiting: prevent excessive mod checks  
      const now = Date.now();
      // if (now - this.lastModCheck < this.modCheckCooldown) {
      //   console.log('🚫 Mod check rate limited, skipping...');
      //   return false;
      // }
      // this.lastModCheck = now;

      console.log('🔍 Checking for shared document mod...');
      const mods = await this.listNetworkMods();
      console.log('📋 Available network mods:', mods);
      
      if (!Array.isArray(mods)) {
        console.warn('⚠️ Mods response is not an array:', mods);
        return false;
      }
      
      // Handle both string arrays and mod info objects
      const modNames = mods.map((mod: any) => {
        if (typeof mod === 'string') {
          return mod;
        } else if (typeof mod === 'object' && mod !== null && mod.name) {
          return mod.name;
        }
        return null;
      }).filter(Boolean);
      
      console.log('🔧 Extracted mod names:', modNames);
      
      const hasSharedDocMod = modNames.includes('shared_document') || 
                              modNames.includes('openagents.mods.work.shared_document');
      
      console.log('✅ Shared document mod detected:', hasSharedDocMod);
      console.log('🔍 Looking for:', ['shared_document', 'openagents.mods.work.shared_document']);
      console.log('📋 Found mods:', mods);
      
      return hasSharedDocMod;
    } catch (error) {
      console.error('❌ Failed to check for shared document mod:', error);
      return false;
    }
  }

  sendDirectMessage(targetAgentId: string, text: string, quote?: string): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.communication.thread_messaging',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'direct_message',
        target_agent_id: targetAgentId,
        quoted_message_id: quote,
        content: { text },
        sender_id: this.agentId
      }
    });

    // Auto-refresh direct messages after sending (after a short delay to let server process)
    setTimeout(() => {
      if (this.isConnected()) {
        this.retrieveDirectMessages(targetAgentId, 50, 0, true);
      } else {
        console.warn('⚠️ Skipping auto-refresh after direct message - connection lost');
      }
    }, 500);
  }

  sendChannelMessage(channel: string, text: string, targetAgent?: string, quote?: string): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.communication.thread_messaging',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'channel_message',
        channel,
        mentioned_agent_id: targetAgent,
        quoted_message_id: quote,
        content: { text },
        sender_id: this.agentId
      },
      sender_id: this.agentId
    });
    
    // Auto-refresh messages after sending (after a short delay to let server process)
    setTimeout(() => {
      if (this.isConnected()) {
        this.retrieveChannelMessages(channel, 50, 0, true);
      } else {
        console.warn('⚠️ Skipping auto-refresh - connection lost');
      }
    }, 500);
  }

  replyToMessage(replyToId: string, text: string, channel?: string, targetAgentId?: string, quote?: string): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.communication.thread_messaging',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'reply_message',
        reply_to_id: replyToId,
        channel,
        target_agent_id: targetAgentId,
        quoted_message_id: quote,
        content: { text },
        sender_id: this.agentId
      }
    });

    // Auto-refresh messages after sending a reply (after a short delay to let server process)
    if (channel) {
      setTimeout(() => {
        if (this.isConnected()) {
          this.retrieveChannelMessages(channel, 50, 0, true);
        } else {
          console.warn('⚠️ Skipping auto-refresh after reply - connection lost');
        }
      }, 500);
    }
  }

  reactToMessage(messageId: string, reactionType: string, action: 'add' | 'remove' = 'add', channel?: string): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.communication.thread_messaging',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'reaction',
        target_message_id: messageId,
        reaction_type: reactionType,
        action,
        sender_id: this.agentId
      }
    });

    // Auto-refresh messages after reacting (after a short delay to let server process)
    if (channel) {
      setTimeout(() => {
        if (this.isConnected()) {
          this.retrieveChannelMessages(channel, 50, 0, true);
        } else {
          console.warn('⚠️ Skipping auto-refresh after reaction - connection lost');
        }
      }, 500);
    }
  }

  listChannels(): void {
    console.log('📤 Sending channel list request...');
    const message = {
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.communication.thread_messaging',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'channel_info_message',
        action: 'list_channels',
        sender_id: this.agentId
      }
    };
    console.log('📤 Channel list message:', JSON.stringify(message, null, 2));
    this.sendMessage(message);
  }

  async listAgents(): Promise<any[]> {
    console.log('📤 Requesting network agents list...');
    try {
      return await this.listNetworkAgents();
    } catch (error) {
      console.error('❌ Failed to get agents list:', error);
      return [];
    }
  }

  retrieveChannelMessages(channel: string, limit = 50, offset = 0, includeThreads = true): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.communication.thread_messaging',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'message_retrieval',
        action: 'retrieve_channel_messages',
        channel,
        limit,
        offset,
        include_threads: includeThreads,
        sender_id: this.agentId
      },
      sender_id: this.agentId
    });
  }

  retrieveDirectMessages(targetAgentId: string, limit = 50, offset = 0, includeThreads = true): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.communication.thread_messaging',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'message_retrieval',
        action: 'retrieve_direct_messages',
        target_agent_id: targetAgentId,
        limit,
        offset,
        include_threads: includeThreads,
        sender_id: this.agentId
      },
      sender_id: this.agentId
    });
  }

  uploadFile(fileData: ArrayBuffer, fileName: string): void {
    const uint8Array = new Uint8Array(fileData);
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const base64Data = btoa(binaryString);
    
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.communication.thread_messaging',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'file_upload_message',
        file_name: fileName,
        file_data: base64Data,
        sender_id: this.agentId
      }
    });
  }

  disconnect(): void {
    this.connectionAborted = true;
    this.connected = false;
    this.isConnecting = false;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  getConnectionStatus(): 'connected' | 'connecting' | 'disconnected' {
    if (this.isConnecting) return 'connecting';
    if (!this.websocket) return 'disconnected';
    
    switch (this.websocket.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return this.connected ? 'connected' : 'connecting';
      default:
        return 'disconnected';
    }
  }

  getCurrentAgentId(): string {
    return this.agentId;
  }

  getOriginalAgentId(): string {
    return this.originalAgentId;
  }

  isUsingModifiedId(): boolean {
    return this.agentId !== this.originalAgentId;
  }

  public isConnected(): boolean {
    return this.websocket !== null && 
           this.websocket.readyState === WebSocket.OPEN && 
           !this.isConnecting && 
           !this.connectionAborted;
  }

  // Shared Document Methods
  
  listDocuments(includeClosedDocuments: boolean = false): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const requestId = `list_documents_${Date.now()}`;
      let isResolved = false;

      this.messageHandlers.set(requestId, (response: any) => {
        if (!isResolved) {
          isResolved = true;
          console.log('📋 Received documents list:', response);
          resolve(response.documents || []);
        }
      });

      this.sendMessage({
        type: 'mod_message',
        message_type: 'mod_message',
        mod: 'openagents.mods.work.shared_document',
        direction: 'outbound',
        relevant_agent_id: this.agentId,
        request_id: requestId,
        content: {
          message_type: 'list_documents',
          include_closed: includeClosedDocuments,
          sender_id: this.agentId
        }
      });

      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.warn('⏰ List documents request timeout for ID:', requestId);
          reject(new Error('List documents request timeout'));
        }
      }, 15000); // Increased from 5000ms to 15000ms (15 seconds)
    });
  }

  getDocumentContent(documentId: string, includeComments: boolean = true, includePresence: boolean = true): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = `get_document_content_${Date.now()}`;
      let isResolved = false;

      this.messageHandlers.set(requestId, (response: any) => {
        if (!isResolved) {
          isResolved = true;
          console.log('📄 Received document content:', response);
          resolve(response);
        }
      });
      
      console.log(`📝 Added getDocumentContent handler for:`, requestId);
      console.log(`📊 Total handlers now:`, this.messageHandlers.size);
      console.log(`🔍 All current handlers:`, Array.from(this.messageHandlers.keys()));

      this.sendMessage({
        type: 'mod_message',
        message_type: 'mod_message',
        mod: 'openagents.mods.work.shared_document',
        direction: 'outbound',
        relevant_agent_id: this.agentId,
        request_id: requestId,
        content: {
          message_type: 'get_document_content',
          document_id: documentId,
          include_comments: includeComments,
          include_presence: includePresence,
          sender_id: this.agentId
        }
      });

      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.warn('⏰ Get document content request timeout for ID:', requestId);
          console.warn('🔍 Handler still exists?', this.messageHandlers.has(requestId));
          console.warn('📊 Total handlers at timeout:', this.messageHandlers.size);
          console.warn('🔍 All handlers at timeout:', Array.from(this.messageHandlers.keys()));
          this.messageHandlers.delete(requestId); // Clean up
          reject(new Error('Get document content request timeout'));
        }
      }, 15000); // Increased from 5000ms to 15000ms (15 seconds)
    });
  }

  createDocument(documentName: string, initialContent: string = '', accessPermissions: Record<string, string> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = `create_document_${Date.now()}`;
      let isResolved = false;

      this.messageHandlers.set(requestId, (response: any) => {
        if (!isResolved) {
          isResolved = true;
          console.log('✅ Document created:', response);
          resolve(response);
        }
      });

      this.sendMessage({
        type: 'mod_message',
        message_type: 'mod_message',
        mod: 'openagents.mods.work.shared_document',
        direction: 'outbound',
        relevant_agent_id: this.agentId,
        request_id: requestId,
        content: {
          message_type: 'create_document',
          document_name: documentName,
          initial_content: initialContent,
          access_permissions: accessPermissions,
          sender_id: this.agentId
        }
      });

      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.warn('⏰ Create document request timeout for ID:', requestId);
          reject(new Error('Create document request timeout'));
        }
      }, 15000); // Increased from 5000ms to 15000ms (15 seconds)
    });
  }

  openDocument(documentId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = `open_document_${Date.now()}`;
      let isResolved = false;

      this.messageHandlers.set(requestId, (response: any) => {
        if (!isResolved) {
          isResolved = true;
          console.log('✅ Open document response received for:', requestId, 'at:', Date.now());
          resolve(response);
        }
      });
      console.log('📝 Added handler for request:', requestId, 'total handlers:', this.messageHandlers.size);

      this.sendMessage({
        type: 'mod_message',
        message_type: 'mod_message',
        mod: 'openagents.mods.work.shared_document',
        direction: 'outbound',
        relevant_agent_id: this.agentId,
        request_id: requestId,
        content: {
          message_type: 'open_document',
          document_id: documentId,
          sender_id: this.agentId
        }
      });

      const timeoutStart = Date.now();
      console.log('⏱️ Setting timeout for request:', requestId, 'at:', timeoutStart);
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          const timeoutEnd = Date.now();
          console.warn('⏰ Open document request timeout for ID:', requestId, 'after:', timeoutEnd - timeoutStart, 'ms');
          console.log('🗑️ Removing handler for timed out request:', requestId);
          this.messageHandlers.delete(requestId);
          reject(new Error('Open document request timeout'));
        } else {
          console.log('✅ Timeout cancelled for resolved request:', requestId);
        }
      }, 15000); // Increased from 5000ms to 15000ms (15 seconds)
    });
  }

  insertLines(documentId: string, lineNumber: number, content: string[]): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.work.shared_document',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'insert_lines',
        document_id: documentId,
        line_number: lineNumber,
        content: content,
        sender_id: this.agentId
      }
    });
  }

  removeLines(documentId: string, startLine: number, endLine: number): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.work.shared_document',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'remove_lines',
        document_id: documentId,
        start_line: startLine,
        end_line: endLine,
        sender_id: this.agentId
      }
    });
  }

  replaceLines(documentId: string, startLine: number, endLine: number, content: string[]): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.work.shared_document',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'replace_lines',
        document_id: documentId,
        start_line: startLine,
        end_line: endLine,
        content: content,
        sender_id: this.agentId
      }
    });
  }

  addComment(documentId: string, lineNumber: number, commentText: string): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.work.shared_document',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'add_comment',
        document_id: documentId,
        line_number: lineNumber,
        comment_text: commentText,
        sender_id: this.agentId
      }
    });
  }

  updateCursorPosition(documentId: string, lineNumber: number, columnNumber: number = 1): void {
    this.sendMessage({
      type: 'mod_message',
      message_type: 'mod_message',
      mod: 'openagents.mods.work.shared_document',
      direction: 'outbound',
      relevant_agent_id: this.agentId,
      content: {
        message_type: 'update_cursor_position',
        document_id: documentId,
        cursor_position: {
          line_number: lineNumber,
          column_number: columnNumber
        },
        sender_id: this.agentId
      }
    });
  }

  getAgentPresence(documentId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = `get_agent_presence_${Date.now()}`;
      let isResolved = false;

      this.messageHandlers.set(requestId, (response: any) => {
        if (!isResolved) {
          isResolved = true;
          console.log('👥 Received agent presence:', response);
          resolve(response);
        }
      });

      this.sendMessage({
        type: 'mod_message',
        message_type: 'mod_message',
        mod: 'openagents.mods.work.shared_document',
        direction: 'outbound',
        relevant_agent_id: this.agentId,
        request_id: requestId,
        content: {
          message_type: 'get_agent_presence',
          document_id: documentId,
          sender_id: this.agentId
        }
      });

      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.warn('⏰ Get agent presence request timeout for ID:', requestId);
          reject(new Error('Get agent presence request timeout'));
        }
      }, 5000);
    });
  }
}

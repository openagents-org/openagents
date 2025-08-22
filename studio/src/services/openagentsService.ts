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
          this.registerAgent(true).then(() => {
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
                await this.registerAgent(true);
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
    return new Promise((resolve, reject) => {
      const registrationMessage = {
        type: 'system_request',
        command: 'register_agent',
        agent_id: this.agentId,
        force_reconnect: forceReconnect,
        metadata: {
          display_name: this.agentId,
          status: 'online',
          capabilities: ['thread_messaging']
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
        request_id: requestId,
        agent_id: this.agentId
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
        request_id: requestId,
        agent_id: this.agentId
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
        request_id: requestId,
        agent_id: this.agentId
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
}

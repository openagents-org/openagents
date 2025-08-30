/**
 * gRPC Web Service for OpenAgents Studio
 * Handles gRPC-Web connections to OpenAgents networks
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

export class OpenAgentsGRPCConnection {
  private agentId: string;
  private originalAgentId: string;
  private networkConnection: NetworkConnection;
  private messageHandlers: Map<string, (message: any) => void> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private connected = false;
  private isConnecting = false;
  private connectionAborted = false;
  private hasReceivedChannels = false;
  private messageQueue: any[] = [];
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastModCheck = 0;
  private modCheckCooldown = 5000; // 5 seconds cooldown between mod checks
  private baseUrl: string;

  constructor(agentId: string, networkConnection: NetworkConnection) {
    this.agentId = agentId;
    this.originalAgentId = agentId;
    this.networkConnection = networkConnection;
    
    // Construct base URL for HTTP/gRPC-Web requests (use HTTP adapter port)
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const httpPort = this.networkConnection.port + 1000; // HTTP adapter runs on gRPC port + 1000
    this.baseUrl = `${protocol}://${this.networkConnection.host}:${httpPort}`;
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
      this.hasReceivedChannels = false;
      
      // Stop any existing polling
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
      
      console.log(`🔌 Attempting gRPC connection...`);
      console.log(`📍 Page URL: ${window.location.href}`);
      console.log(`🌐 Target: ${this.baseUrl}`);
      console.log(`👤 Agent: ${this.agentId}`);

      // Try to register agent via HTTP POST (gRPC-Web style)
      const success = await this.registerAgent();
      
      if (success) {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        
        // Start polling for messages
        this.startPolling();
        
        console.log('✅ gRPC connection established successfully');
        this.emit('connected', { agentId: this.agentId });
        
        return true;
      } else {
        throw new Error('Failed to register agent');
      }

    } catch (error: any) {
      console.error('❌ gRPC connection failed:', error);
      this.isConnecting = false;
      
      // Handle agent ID conflicts
      if (error.message?.includes('agent_id_conflict') && retryWithUniqueId) {
        console.log('🔄 Agent ID conflict detected, generating unique ID...');
        this.agentId = this.generateUniqueAgentId(this.originalAgentId);
        console.log(`🆔 New agent ID: ${this.agentId}`);
        return this.connect(false); // Retry with unique ID, but don't retry again
      }
      
      this.emit('connectionError', { error: error.message });
      this.handleReconnect();
      return false;
    }
  }

  private async registerAgent(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          metadata: {
            display_name: this.agentId,
            user_agent: navigator.userAgent,
            platform: 'web'
          },
          capabilities: ['thread_messaging', 'shared_document']
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.success === true;
      
    } catch (error) {
      console.error('Failed to register agent:', error);
      throw error;
    }
  }

  private startPolling(): void {
    // Poll for messages every 2 seconds
    this.pollingInterval = setInterval(async () => {
      if (!this.connected || this.connectionAborted) {
        return;
      }

      try {
        await this.pollMessages();
      } catch (error) {
        console.error('Polling error:', error);
        this.handleReconnect();
      }
    }, 2000);
  }

  private async pollMessages(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/poll/${this.agentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.messages && Array.isArray(data.messages)) {
        for (const message of data.messages) {
          this.handleMessage(message);
        }
      }
      
    } catch (error) {
      throw error;
    }
  }

  disconnect(): void {
    console.log('🔌 Disconnecting from gRPC service...');
    
    this.connectionAborted = true;
    this.connected = false;
    
    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    // Unregister agent
    this.unregisterAgent().catch(console.error);
    
    this.emit('disconnected', { reason: 'Manual disconnect' });
  }

  private async unregisterAgent(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/unregister`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId
        })
      });
    } catch (error) {
      console.error('Failed to unregister agent:', error);
    }
  }

  private handleMessage(message: any): void {
    try {
      console.log('📨 Received message:', message);
      
      // Route message to appropriate handler
      const messageType = message.message_type || message.type;
      
      if (messageType === 'system_response') {
        this.handleSystemResponse(message);
      } else if (messageType === 'direct_message' || messageType === 'channel_message') {
        this.emit('message', message);
      } else {
        console.log(`📨 Unhandled message type: ${messageType}`);
      }
      
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  private handleSystemResponse(message: any): void {
    const command = message.command;
    
    switch (command) {
      case 'list_channels':
        this.hasReceivedChannels = true;
        this.emit('channels', message.data?.channels || []);
        break;
      case 'get_channel_messages':
        this.emit('channel_messages', message.data || {});
        break;
      case 'get_direct_messages':
        this.emit('direct_messages', message.data || {});
        break;
      case 'list_agents':
        this.emit('agents', message.data?.agents || []);
        break;
      case 'react_to_message':
        // Handle reaction responses
        if (message.data && message.data.action) {
          this.emit('reaction', message.data);
        }
        break;
      default:
        console.log(`Unhandled system response: ${command}`);
    }
  }

  async sendMessage(content: string, channel?: string, targetAgentId?: string, replyToId?: string, quotedMessageId?: string, quotedText?: string): Promise<boolean> {
    if (!this.connected) {
      console.error('Cannot send message: not connected');
      return false;
    }

    try {
      const messageData = {
        sender_id: this.agentId,
        content: { text: content },
        message_type: channel ? 'channel_message' : 'direct_message',
        channel: channel,
        target_agent_id: targetAgentId,
        reply_to_id: replyToId,
        quoted_message_id: quotedMessageId,
        quoted_text: quotedText,
        timestamp: new Date().toISOString()
      };

      const response = await fetch(`${this.baseUrl}/api/send_message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageData)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      return result.success === true;
      
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  async getChannels(): Promise<void> {
    try {
      await this.sendSystemCommand('list_channels', {});
      
      // If no channels are received after a timeout, provide default channels
      setTimeout(() => {
        if (!this.hasReceivedChannels) {
          console.log('📋 No channels received from backend, providing default channels');
          const defaultChannels: ThreadMessagingChannel[] = [
            { 
              name: 'general', 
              description: 'General discussion', 
              message_count: 0, 
              agents: [], 
              thread_count: 0 
            },
            { 
              name: 'development', 
              description: 'Development discussions', 
              message_count: 0, 
              agents: [], 
              thread_count: 0 
            },
            { 
              name: 'support', 
              description: 'Support and help', 
              message_count: 0, 
              agents: [], 
              thread_count: 0 
            }
          ];
          this.emit('channels', defaultChannels);
        }
      }, 2000); // Wait 2 seconds for backend response
    } catch (error) {
      console.error('Error getting channels:', error);
      // Provide default channels on error
      const defaultChannels: ThreadMessagingChannel[] = [
        { 
          name: 'general', 
          description: 'General discussion', 
          message_count: 0, 
          agents: [], 
          thread_count: 0 
        },
        { 
          name: 'development', 
          description: 'Development discussions', 
          message_count: 0, 
          agents: [], 
          thread_count: 0 
        }
      ];
      this.emit('channels', defaultChannels);
    }
  }

  async getChannelMessages(channelName: string): Promise<void> {
    await this.sendSystemCommand('get_channel_messages', { channel: channelName });
  }

  async getDirectMessages(targetAgentId?: string): Promise<void> {
    await this.sendSystemCommand('get_direct_messages', { target_agent_id: targetAgentId });
  }

  async getAgents(): Promise<void> {
    await this.sendSystemCommand('list_agents', {});
  }

  // Compatibility methods for ThreadMessagingView
  async listChannels(): Promise<void> {
    return this.getChannels();
  }

  async listAgents(): Promise<any[]> {
    await this.getAgents();
    return []; // Return empty array for now, actual data comes via events
  }

  async retrieveChannelMessages(channelName: string, limit: number = 50, offset: number = 0, includeThreads: boolean = true): Promise<void> {
    return this.getChannelMessages(channelName);
  }

  async retrieveDirectMessages(targetAgentId: string, limit: number = 50, offset: number = 0, includeThreads: boolean = true): Promise<void> {
    return this.getDirectMessages(targetAgentId);
  }

  async sendChannelMessage(channel: string, text: string, replyToId?: string, quotedMessageId?: string): Promise<boolean> {
    return this.sendMessage(text, channel, undefined, replyToId, quotedMessageId);
  }

  async sendDirectMessage(targetAgentId: string, text: string, quotedMessageId?: string): Promise<boolean> {
    return this.sendMessage(text, undefined, targetAgentId, undefined, quotedMessageId);
  }

  async replyToMessage(replyToId: string, text: string, channel?: string, targetAgentId?: string, quotedMessageId?: string): Promise<boolean> {
    return this.sendMessage(text, channel, targetAgentId, replyToId, quotedMessageId);
  }

  async reactToMessage(messageId: string, reactionType: string, action: 'add' | 'remove' = 'add', channel?: string): Promise<boolean> {
    try {
      await this.sendSystemCommand('react_to_message', {
        target_message_id: messageId,
        reaction_type: reactionType,
        action: action
      });
      return true;
    } catch (error) {
      console.error('Failed to react to message:', error);
      return false;
    }
  }

  // Agent ID management methods
  isUsingModifiedId(): boolean {
    return this.agentId !== this.originalAgentId;
  }

  getCurrentAgentId(): string {
    return this.agentId;
  }

  getOriginalAgentId(): string {
    return this.originalAgentId;
  }

  private async sendSystemCommand(command: string, data: any): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/system_command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          command: command,
          data: data
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
    } catch (error) {
      console.error(`Failed to send system command ${command}:`, error);
    }
  }

  async hasThreadMessagingMod(): Promise<boolean> {
    // For gRPC, we assume the mod is available if we can connect
    return this.connected;
  }

  async addReaction(messageId: string, reactionType: string): Promise<boolean> {
    return this.reactToMessage(messageId, reactionType, 'add');
  }

  on(event: string, handler: (data: any) => void): void {
    this.messageHandlers.set(event, handler);
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

  isConnected(): boolean {
    return this.connected;
  }

  getAgentId(): string {
    return this.agentId;
  }

  // Document-related methods for shared documents mod
  async hasSharedDocumentMod(): Promise<boolean> {
    try {
      // Check if the shared documents mod is available by trying to list documents
      const response = await fetch(`${this.baseUrl}/api/system_command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          command: 'check_mod',
          data: {
            mod_name: 'shared_documents'
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        return result.success && result.response_data?.available === true;
      }
      return false;
    } catch (error) {
      console.error('Error checking shared documents mod:', error);
      return false;
    }
  }

  async listDocuments(includeArchived: boolean = false): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/system_command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          command: 'list_documents',
          data: {
            include_archived: includeArchived
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        return result.success ? (result.response_data?.documents || []) : [];
      }
      return [];
    } catch (error) {
      console.error('Error listing documents:', error);
      return [];
    }
  }

  async getDocumentContent(documentId: string, includeComments: boolean = true, includePresence: boolean = true): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/api/system_command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          command: 'get_document_content',
          data: {
            document_id: documentId,
            include_comments: includeComments,
            include_presence: includePresence
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        return result.success ? result.response_data : null;
      }
      return null;
    } catch (error) {
      console.error('Error getting document content:', error);
      return null;
    }
  }

  async replaceLines(documentId: string, startLine: number, endLine: number, content: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/system_command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          command: 'replace_lines',
          data: {
            document_id: documentId,
            start_line: startLine,
            end_line: endLine,
            content: content
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        return result.success;
      }
      return false;
    } catch (error) {
      console.error('Error replacing lines:', error);
      return false;
    }
  }
}

/**
 * Updated gRPC Web Service for OpenAgents Studio
 * Now uses the new WorkspaceService for event-based communication
 */

import { NetworkConnection } from './networkService';
import { 
  WorkspaceService, 
  WorkspaceChannel, 
  WorkspaceMessage, 
  WorkspaceAgent, 
  WorkspaceEvent 
} from './workspaceService';

// Re-export types for backward compatibility
export interface OpenAgentsNetworkInfo {
  name: string;
  node_id: string;
  mode: 'centralized' | 'decentralized';
  mods: string[];
  agent_count: number;
}

export interface ThreadMessagingChannel extends WorkspaceChannel {}
export interface ThreadMessage extends WorkspaceMessage {}
export interface AgentInfo extends WorkspaceAgent {}

/**
 * Updated OpenAgents connection that uses the new event system
 */
export class OpenAgentsGRPCConnection {
  private agentId: string;
  private originalAgentId: string;
  private networkConnection: NetworkConnection;
  private workspaceService: WorkspaceService;
  private messageHandlers: Map<string, (message: any) => void> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private connected = false;
  private isConnecting = false;
  private connectionAborted = false;
  private hasReceivedChannels = false;
  private messageQueue: any[] = [];
  private lastModCheck = 0;
  private modCheckCooldown = 5000;
  private baseUrl: string;

  constructor(agentId: string, networkConnection: NetworkConnection) {
    this.agentId = agentId;
    this.originalAgentId = agentId;
    this.networkConnection = networkConnection;
    
    // Create workspace service
    this.workspaceService = new WorkspaceService(agentId, networkConnection);
    
    // Construct base URL for HTTP/gRPC-Web requests (use HTTP adapter port)
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const httpPort = this.networkConnection.port + 1000;
    this.baseUrl = `${protocol}://${this.networkConnection.host}:${httpPort}`;
    
    // Set up workspace event handlers
    this.setupWorkspaceEventHandlers();
  }

  private generateUniqueAgentId(baseId: string, attempt: number = 1): string {
    if (attempt === 1) {
      return `${baseId}_${Date.now()}`;
    }
    return `${baseId}_${Date.now()}_${attempt}`;
  }

  /**
   * Set up event handlers for workspace events
   */
  private setupWorkspaceEventHandlers(): void {
    // Handle channel message events
    this.workspaceService.on('channel.message.*', (event: WorkspaceEvent) => {
      console.log('📨 Channel message event:', event);
      
      if (event.payload && event.payload.messages) {
        // This is a message list response
        this.emit('channel_messages', {
          channel: event.target_channel,
          messages: event.payload.messages,
          total_count: event.payload.total_count || event.payload.messages.length,
          has_more: event.payload.has_more || false
        });
      } else if (event.payload && event.payload.text) {
        // This is a new message
        this.emit('message', {
          type: 'channel_message',
          channel: event.target_channel,
          message: {
            message_id: event.event_id,
            sender_id: event.source_agent_id,
            timestamp: event.timestamp,
            content: { text: event.payload.text },
            message_type: 'channel_message',
            channel: event.target_channel
          }
        });
      }
    });

    // Handle channel list events
    this.workspaceService.on('channel.*', (event: WorkspaceEvent) => {
      console.log('📂 Channel event:', event);
      
      if (event.event_name === 'channel.list' && event.payload && event.payload.channels) {
        this.hasReceivedChannels = true;
        this.emit('channels', event.payload.channels);
      }
    });

    // Handle agent events
    this.workspaceService.on('agent.*', (event: WorkspaceEvent) => {
      console.log('👥 Agent event:', event);
      
      if (event.event_name === 'agent.list' && event.payload && event.payload.agents) {
        this.emit('agents', event.payload.agents);
      }
    });

    // Handle direct message events
    this.workspaceService.on('thread.message.direct', (event: WorkspaceEvent) => {
      console.log('💬 Direct message event:', event);
      
      if (event.payload && event.payload.messages) {
        this.emit('direct_messages', {
          target_agent_id: event.target_agent_id,
          messages: event.payload.messages,
          total_count: event.payload.total_count || event.payload.messages.length
        });
      }
    });

    // Handle reaction events
    this.workspaceService.on('message.reaction.*', (event: WorkspaceEvent) => {
      console.log('😀 Reaction event:', event);
      
      if (event.payload) {
        this.emit('reaction', {
          message_id: event.payload.message_id,
          reaction_type: event.payload.reaction_type,
          action: event.payload.action,
          sender_id: event.source_agent_id
        });
      }
    });
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
      
      console.log(`🔌 Attempting workspace connection...`);
      console.log(`📍 Page URL: ${window.location.href}`);
      console.log(`🌐 Target: ${this.baseUrl}`);
      console.log(`👤 Agent: ${this.agentId}`);

      // Connect to workspace service
      const connected = await this.workspaceService.connect();
      
      if (connected) {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        
        console.log('✅ Workspace connection established successfully');
        this.emit('connected', { agentId: this.agentId });
        
        return true;
      } else {
        throw new Error('Failed to connect to workspace');
      }

    } catch (error: any) {
      console.error('❌ Workspace connection failed:', error);
      this.isConnecting = false;
      
      // Handle agent ID conflicts
      if (error.message?.includes('agent_id_conflict') && retryWithUniqueId) {
        console.log('🔄 Agent ID conflict detected, generating unique ID...');
        this.agentId = this.generateUniqueAgentId(this.originalAgentId);
        console.log(`🆔 New agent ID: ${this.agentId}`);
        
        // Create new workspace service with new agent ID
        this.workspaceService = new WorkspaceService(this.agentId, this.networkConnection);
        this.setupWorkspaceEventHandlers();
        
        return this.connect(false); // Retry with unique ID, but don't retry again
      }
      
      this.emit('connectionError', { error: error.message });
      this.handleReconnect();
      return false;
    }
  }

  async disconnect(): Promise<void> {
    console.log('🔌 Disconnecting...');
    this.connectionAborted = true;
    this.connected = false;
    
    // Disconnect workspace service
    await this.workspaceService.disconnect();
    
    this.emit('disconnected', {});
  }

  private handleReconnect(): void {
    if (this.connectionAborted || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max reconnection attempts reached or connection aborted');
      this.emit('connectionFailed', {});
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
    
    setTimeout(() => {
      if (!this.connectionAborted) {
        this.connect(false);
      }
    }, delay);
  }

  private handleReconnecting(): void {
    this.emit('reconnecting', {});
  }

  private handleReconnected(): void {
    this.emit('reconnected', {});
  }

  private handleConnectionLost(): void {
    this.connected = false;
    this.emit('connectionLost', {});
    this.handleReconnect();
  }

  // Event handling
  on(event: string, handler: (message: any) => void): void {
    this.messageHandlers.set(event, handler);
  }

  off(event: string): void {
    this.messageHandlers.delete(event);
  }

  private emit(event: string, data: any): void {
    const handler = this.messageHandlers.get(event);
    if (handler) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in ${event} handler:`, error);
      }
    }
  }

  // API Methods - now using workspace service
  async getChannels(): Promise<void> {
    try {
      console.log('📂 Requesting channels via workspace...');
      const channels = await this.workspaceService.getChannels();
      
      // Emit channels event
      this.hasReceivedChannels = true;
      this.emit('channels', channels);
      
    } catch (error) {
      console.error('Failed to get channels:', error);
      
      // Emit default channels as fallback
      const defaultChannels = [
        { name: 'general', description: 'General discussion', agents: [], message_count: 0, thread_count: 0 },
        { name: 'development', description: 'Development discussions', agents: [], message_count: 0, thread_count: 0 },
        { name: 'support', description: 'Support and help', agents: [], message_count: 0, thread_count: 0 }
      ];
      
      this.emit('channels', defaultChannels);
    }
  }

  async getChannelMessages(channelName: string): Promise<void> {
    try {
      console.log(`💬 Requesting messages for channel: ${channelName}`);
      const messages = await this.workspaceService.getChannelMessages(channelName);
      
      // Emit channel messages event
      this.emit('channel_messages', {
        channel: channelName,
        messages: messages,
        total_count: messages.length,
        has_more: false
      });
      
    } catch (error) {
      console.error(`Failed to get messages for ${channelName}:`, error);
      
      // Emit empty messages as fallback
      this.emit('channel_messages', {
        channel: channelName,
        messages: [],
        total_count: 0,
        has_more: false
      });
    }
  }

  async getDirectMessages(targetAgentId?: string): Promise<void> {
    // For now, emit empty direct messages
    // This can be implemented when direct messaging is needed
    this.emit('direct_messages', {
      target_agent_id: targetAgentId,
      messages: [],
      total_count: 0
    });
  }

  async listAgents(): Promise<any[]> {
    try {
      console.log('👥 Requesting agents via workspace...');
      const agents = await this.workspaceService.getAgents();
      
      // Emit agents event
      this.emit('agents', agents);
      
      return agents;
    } catch (error) {
      console.error('Failed to get agents:', error);
      
      // Emit empty agents as fallback
      this.emit('agents', []);
      return [];
    }
  }

  async retrieveChannelMessages(channelName: string, limit: number = 50, offset: number = 0, includeThreads: boolean = true): Promise<void> {
    return this.getChannelMessages(channelName);
  }

  async retrieveDirectMessages(targetAgentId: string, limit: number = 50, offset: number = 0, includeThreads: boolean = true): Promise<void> {
    return this.getDirectMessages(targetAgentId);
  }

  async sendMessage(content: string, targetAgentId?: string, channel?: string, replyToId?: string): Promise<boolean> {
    try {
      if (channel) {
        // Send channel message
        return await this.workspaceService.sendChannelMessage(channel, content, replyToId);
      } else {
        // Direct messages not implemented yet
        console.warn('Direct messages not implemented in workspace service yet');
        return false;
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  async reactToMessage(messageId: string, reactionType: string): Promise<boolean> {
    try {
      return await this.workspaceService.reactToMessage(messageId, reactionType);
    } catch (error) {
      console.error('Failed to react to message:', error);
      return false;
    }
  }

  getAgentId(): string {
    return this.agentId;
  }

  getOriginalAgentId(): string {
    return this.originalAgentId;
  }

  async hasThreadMessagingMod(): Promise<boolean> {
    // For workspace service, we assume thread messaging is available if connected
    return this.connected;
  }

  async hasSharedDocumentsMod(): Promise<boolean> {
    // For now, assume shared documents are not available
    // This can be implemented when needed
    return false;
  }

  isConnected(): boolean {
    return this.connected && this.workspaceService.isConnected();
  }

  // Legacy methods for backward compatibility
  private async sendSystemCommand(command: string, data: any): Promise<void> {
    console.warn(`Legacy sendSystemCommand called: ${command}`, data);
    
    // Map legacy commands to new workspace methods
    switch (command) {
      case 'list_channels':
        await this.getChannels();
        break;
      case 'get_channel_messages':
        if (data.channel) {
          await this.getChannelMessages(data.channel);
        }
        break;
      case 'list_agents':
        await this.listAgents();
        break;
      case 'get_direct_messages':
        if (data.target_agent_id) {
          await this.getDirectMessages(data.target_agent_id);
        }
        break;
      default:
        console.warn(`Unknown legacy command: ${command}`);
    }
  }
}

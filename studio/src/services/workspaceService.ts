/**
 * WorkspaceService - Studio adapter for the new OpenAgents event system
 * 
 * This service provides a workspace-like API that works with the redesigned
 * event system, similar to the Python workspace examples.
 */

import { NetworkConnection } from './networkService';

export interface WorkspaceChannel {
  name: string;
  description: string;
  agents: string[];
  message_count: number;
  thread_count: number;
}

export interface WorkspaceMessage {
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

export interface WorkspaceAgent {
  agent_id: string;
  display_name?: string;
  status?: 'online' | 'offline' | 'away';
  last_activity: string;
}

export interface EventSubscription {
  subscription_id: string;
  agent_id: string;
  event_patterns: string[];
}

export interface WorkspaceEvent {
  event_name: string;
  source_agent_id: string;
  target_agent_id?: string;
  target_channel?: string;
  payload: any;
  timestamp: string;
  event_id: string;
}

export class WorkspaceService {
  private agentId: string;
  private networkConnection: NetworkConnection;
  private baseUrl: string;
  private connected = false;
  private eventSubscription: EventSubscription | null = null;
  private eventHandlers: Map<string, (event: WorkspaceEvent) => void> = new Map();
  private eventQueue: WorkspaceEvent[] = [];
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(agentId: string, networkConnection: NetworkConnection) {
    this.agentId = agentId;
    this.networkConnection = networkConnection;
    
    // Use HTTP adapter port (gRPC port + 1000)
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const httpPort = this.networkConnection.port + 1000;
    this.baseUrl = `${protocol}://${this.networkConnection.host}:${httpPort}`;
  }

  /**
   * Connect to the workspace and set up event handling
   */
  async connect(): Promise<boolean> {
    try {
      console.log('🔌 Connecting to workspace...');
      
      // Register agent with the network
      const registered = await this.registerAgent();
      if (!registered) {
        throw new Error('Failed to register agent with network');
      }

      this.connected = true;
      console.log('✅ Workspace connected successfully');

      // Set up event subscription for real-time updates
      await this.setupEventSubscription();
      
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to workspace:', error);
      return false;
    }
  }

  /**
   * Disconnect from the workspace
   */
  async disconnect(): Promise<void> {
    console.log('🔌 Disconnecting from workspace...');
    
    // Stop event polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    // Unsubscribe from events
    if (this.eventSubscription) {
      await this.unsubscribeFromEvents();
    }
    
    this.connected = false;
    console.log('✅ Workspace disconnected');
  }

  /**
   * Register agent with the network
   */
  private async registerAgent(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          agent_type: 'studio_client',
          capabilities: ['thread_messaging', 'workspace']
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      console.error('Failed to register agent:', error);
      return false;
    }
  }

  /**
   * Set up event subscription for real-time updates
   */
  private async setupEventSubscription(): Promise<void> {
    try {
      console.log('📡 Setting up event subscription...');
      
      // Subscribe to relevant events
      const eventPatterns = [
        'channel.message.*',
        'thread.message.*',
        'agent.*',
        'channel.*'
      ];

      const response = await fetch(`${this.baseUrl}/api/events/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          event_patterns: eventPatterns
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          this.eventSubscription = {
            subscription_id: result.subscription_id,
            agent_id: this.agentId,
            event_patterns: eventPatterns
          };
          
          console.log('✅ Event subscription created:', this.eventSubscription.subscription_id);
          
          // Start polling for events
          this.startEventPolling();
        }
      } else {
        console.warn('⚠️ Event subscription failed, falling back to polling-only mode');
        // Still start polling for basic functionality
        this.startEventPolling();
      }
    } catch (error) {
      console.warn('⚠️ Event subscription setup failed:', error);
      // Fall back to polling-only mode
      this.startEventPolling();
    }
  }

  /**
   * Start polling for events
   */
  private startEventPolling(): void {
    if (this.isPolling) return;
    
    this.isPolling = true;
    console.log('🔄 Starting event polling...');
    
    this.pollingInterval = setInterval(async () => {
      await this.pollForEvents();
    }, 2000); // Poll every 2 seconds
  }

  /**
   * Poll for events from the network
   */
  private async pollForEvents(): Promise<void> {
    if (!this.connected) return;
    
    try {
      const response = await fetch(`${this.baseUrl}/api/poll/${this.agentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const result = await response.json();
        if (result.events && Array.isArray(result.events)) {
          for (const event of result.events) {
            this.handleEvent(event);
          }
        }
      }
    } catch (error) {
      // Silently handle polling errors to avoid spam
      console.debug('Event polling error:', error);
    }
  }

  /**
   * Handle incoming events
   */
  private handleEvent(event: WorkspaceEvent): void {
    console.log('📨 Received event:', event.event_name);
    
    // Add to event queue
    this.eventQueue.push(event);
    
    // Trigger registered handlers
    this.eventHandlers.forEach((handler, pattern) => {
      if (this.matchesPattern(event.event_name, pattern)) {
        try {
          handler(event);
        } catch (error) {
          console.error('Error in event handler:', error);
        }
      }
    });
  }

  /**
   * Check if event name matches pattern
   */
  private matchesPattern(eventName: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return eventName.startsWith(prefix);
    }
    return eventName === pattern;
  }

  /**
   * Subscribe to events with a handler
   */
  on(eventPattern: string, handler: (event: WorkspaceEvent) => void): void {
    this.eventHandlers.set(eventPattern, handler);
  }

  /**
   * Unsubscribe from events
   */
  off(eventPattern: string): void {
    this.eventHandlers.delete(eventPattern);
  }

  /**
   * Unsubscribe from events on the server
   */
  private async unsubscribeFromEvents(): Promise<void> {
    if (!this.eventSubscription) return;
    
    try {
      await fetch(`${this.baseUrl}/api/events/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription_id: this.eventSubscription.subscription_id
        })
      });
      
      this.eventSubscription = null;
      console.log('✅ Unsubscribed from events');
    } catch (error) {
      console.error('Failed to unsubscribe from events:', error);
    }
  }

  /**
   * Get list of available channels
   */
  async getChannels(): Promise<WorkspaceChannel[]> {
    try {
      console.log('📂 Fetching channels...');
      
      const response = await fetch(`${this.baseUrl}/api/workspace/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          action: 'list_channels'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.channels) {
        console.log('✅ Channels retrieved:', result.channels.length);
        return result.channels;
      } else {
        // Return default channels if none found
        console.log('📂 Using default channels');
        return [
          { name: 'general', description: 'General discussion', agents: [], message_count: 0, thread_count: 0 },
          { name: 'development', description: 'Development discussions', agents: [], message_count: 0, thread_count: 0 },
          { name: 'support', description: 'Support and help', agents: [], message_count: 0, thread_count: 0 }
        ];
      }
    } catch (error) {
      console.error('Failed to get channels:', error);
      // Return default channels as fallback
      return [
        { name: 'general', description: 'General discussion', agents: [], message_count: 0, thread_count: 0 },
        { name: 'development', description: 'Development discussions', agents: [], message_count: 0, thread_count: 0 },
        { name: 'support', description: 'Support and help', agents: [], message_count: 0, thread_count: 0 }
      ];
    }
  }

  /**
   * Get messages from a channel
   */
  async getChannelMessages(channelName: string, limit: number = 50, offset: number = 0): Promise<WorkspaceMessage[]> {
    try {
      console.log(`💬 Fetching messages for channel: ${channelName}`);
      
      const response = await fetch(`${this.baseUrl}/api/workspace/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          action: 'get_channel_messages',
          channel: channelName,
          limit: limit,
          offset: offset,
          include_threads: true
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.messages) {
        console.log(`✅ Retrieved ${result.messages.length} messages from ${channelName}`);
        return result.messages;
      } else {
        console.log(`📭 No messages found in ${channelName}`);
        return [];
      }
    } catch (error) {
      console.error(`Failed to get messages for ${channelName}:`, error);
      return [];
    }
  }

  /**
   * Send a message to a channel
   */
  async sendChannelMessage(channelName: string, text: string, replyToId?: string): Promise<boolean> {
    try {
      console.log(`📤 Sending message to ${channelName}: ${text.substring(0, 50)}...`);
      
      const response = await fetch(`${this.baseUrl}/api/send_message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender_id: this.agentId,
          message_type: 'channel_message',
          channel: channelName,
          content: { text: text },
          reply_to_id: replyToId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Message sent successfully');
        return true;
      } else {
        console.error('❌ Failed to send message:', result.error);
        return false;
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  /**
   * Get list of online agents
   */
  async getAgents(): Promise<WorkspaceAgent[]> {
    try {
      console.log('👥 Fetching agents...');
      
      const response = await fetch(`${this.baseUrl}/api/workspace/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          action: 'list_agents'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.agents) {
        console.log('✅ Agents retrieved:', result.agents.length);
        return result.agents;
      } else {
        console.log('👥 No agents found');
        return [];
      }
    } catch (error) {
      console.error('Failed to get agents:', error);
      return [];
    }
  }

  /**
   * React to a message
   */
  async reactToMessage(messageId: string, reactionType: string): Promise<boolean> {
    try {
      console.log(`😀 Adding reaction ${reactionType} to message ${messageId}`);
      
      const response = await fetch(`${this.baseUrl}/api/workspace/react`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          action: 'react_to_message',
          target_message_id: messageId,
          reaction_type: reactionType
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Reaction added successfully');
        return true;
      } else {
        console.error('❌ Failed to add reaction:', result.error);
        return false;
      }
    } catch (error) {
      console.error('Failed to add reaction:', error);
      return false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Get recent events from queue
   */
  getRecentEvents(limit: number = 10): WorkspaceEvent[] {
    return this.eventQueue.slice(-limit);
  }

  /**
   * Clear event queue
   */
  clearEventQueue(): void {
    this.eventQueue = [];
  }
}

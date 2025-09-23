/**
 * HTTP Event Connector for OpenAgents Studio
 *
 * This connector implements the new event-driven architecture using HTTP transport.
 * It provides immediate EventResponse feedback via HTTP transport.
 */

import { Event, EventResponse, EventNames, AgentInfo } from "@/types/events";

export interface ConnectionOptions {
  host: string;
  port: number;
  agentId: string;
  metadata?: any;
  timeout?: number;
}

export interface EventHandler {
  (event: Event): void;
}

export class HttpEventConnector {
  private agentId: string;
  private originalAgentId: string;
  private baseUrl: string;
  private connected = false;
  private isConnecting = false;
  private connectionAborted = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private timeout: number;

  constructor(options: ConnectionOptions) {
    this.agentId = options.agentId;
    this.originalAgentId = options.agentId;
    this.timeout = options.timeout || 30000;

    // Construct base URL for HTTP requests (user enters HTTP port directly)
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    this.baseUrl = `${protocol}://${options.host}:${options.port}/api`;
  }

  /**
   * Connect to the OpenAgents network
   */
  async connect(retryWithUniqueId: boolean = true): Promise<boolean> {
    try {
      if (this.isConnecting) {
        console.log("⚠️ Connection attempt ignored - already connecting");
        return false;
      }

      this.connectionAborted = false;
      this.isConnecting = true;

      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }

      console.log(`🔌 Connecting to OpenAgents network...`);
      console.log(`🌐 Target: ${this.baseUrl}`);
      console.log(`👤 Agent: ${this.agentId}`);

      // Health check
      console.log(`📡 Sending health check to ${this.baseUrl}/health`);
      const healthResponse = await this.sendHttpRequest("/health", "GET");
      console.log("📡 Health check response:", healthResponse);
      if (!healthResponse.success) {
        throw new Error(
          `Health check failed: ${healthResponse.message || "Unknown error"}`
        );
      }

      // Register agent
      console.log(`📡 Sending registration to ${this.baseUrl}/register`);
      const registerResponse = await this.sendHttpRequest("/register", "POST", {
        agent_id: this.agentId,
        metadata: {
          display_name: this.agentId,
          user_agent: navigator.userAgent,
          platform: "web",
        },
      });

      console.log("📡 Registration response:", registerResponse);
      if (!registerResponse.success) {
        throw new Error(
          registerResponse.error_message || "Registration failed"
        );
      }

      this.connected = true;
      this.reconnectAttempts = 0;
      this.isConnecting = false;

      // Start polling for events
      this.startEventPolling();

      console.log("✅ Connected to OpenAgents network successfully");
      this.emit("connected", { agentId: this.agentId });

      return true;
    } catch (error: any) {
      console.error("❌ Connection failed:", error);
      this.isConnecting = false;

      // Handle agent ID conflicts
      if (error.message?.includes("agent_id_conflict") && retryWithUniqueId) {
        console.log("🔄 Agent ID conflict detected, generating unique ID...");
        this.agentId = this.generateUniqueAgentId(this.originalAgentId);
        console.log(`🆔 New agent ID: ${this.agentId}`);
        return this.connect(false);
      }

      this.emit("connectionError", { error: error.message });
      this.handleReconnect();
      return false;
    }
  }

  /**
   * Disconnect from the network
   */
  async disconnect(): Promise<void> {
    console.log("🔌 Disconnecting from OpenAgents network...");

    this.connectionAborted = true;
    this.connected = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    try {
      await this.sendHttpRequest("/unregister", "POST", {
        agent_id: this.agentId,
      });
    } catch (error) {
      // Don't log unregister errors as errors since they often happen during cleanup
      console.warn(
        "Failed to unregister agent (this is usually harmless):",
        error
      );
    }

    this.emit("disconnected", { reason: "Manual disconnect" });
  }

  /**
   * Send an event to the network and get immediate EventResponse
   */
  async sendEvent(event: Event): Promise<EventResponse> {
    if (!this.connected) {
      console.warn(`Agent ${this.agentId} is not connected to network`);
      return {
        success: false,
        message: "Agent is not connected to network",
      };
    }

    try {
      // Ensure source_id is set
      if (!event.source_id) {
        event.source_id = this.agentId;
      }

      // Generate event_id if not provided
      if (!event.event_id) {
        event.event_id = `${this.agentId}_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
      }

      // Set timestamp
      if (!event.timestamp) {
        event.timestamp = Math.floor(Date.now() / 1000);
      }

      console.log(
        `📤 Sending event: ${event.event_name} from ${event.source_id}`
      );

      const response = await this.sendHttpRequest("/send_event", "POST", {
        event_id: event.event_id,
        event_name: event.event_name,
        source_id: event.source_id,
        target_agent_id: event.destination_id,
        payload: event.payload || {},
        metadata: event.metadata || {},
        visibility: event.visibility || "network",
      });

      const eventResponse: EventResponse = {
        success: response.success,
        message: response.message,
        data: response.data,
        event_name: event.event_name,
      };

      if (eventResponse.success) {
        console.log(`✅ Event sent successfully: ${event.event_name}`);
      } else {
        console.error(
          `❌ Event failed: ${event.event_name} - ${eventResponse.message}`
        );
      }

      return eventResponse;
    } catch (error: any) {
      const errorMessage = `Failed to send event ${event.event_name}: ${error.message}`;
      console.error(errorMessage);

      return {
        success: false,
        message: errorMessage,
        event_name: event.event_name,
      };
    }
  }

  /**
   * Convenience methods for common thread messaging operations
   */
  async sendDirectMessage(
    targetAgentId: string,
    content: string
  ): Promise<EventResponse> {
    return this.sendEvent({
      event_name: EventNames.THREAD_DIRECT_MESSAGE_SEND,
      source_id: this.agentId,
      destination_id: `agent:${targetAgentId}`,
      payload: {
        target_agent_id: targetAgentId,
        text: content,
        message_type: "direct_message",
      },
    });
  }

  async sendChannelMessage(
    channel: string,
    content: string,
    replyToId?: string
  ): Promise<EventResponse> {
    const payload: any = {
      channel: channel,
      text: content,  // Updated: use 'text' directly instead of nested 'content.text'
      message_type: "channel_message",
    };

    if (replyToId) {
      payload.reply_to_id = replyToId;
      payload.message_type = "reply_message";
    }

    return this.sendEvent({
      event_name: replyToId
        ? EventNames.THREAD_REPLY_SENT
        : EventNames.THREAD_CHANNEL_MESSAGE_POST,
      source_id: this.agentId,
      destination_id: `channel:${channel}`,
      payload,
    });
  }

  async addReaction(
    messageId: string,
    reactionType: string,
    channel?: string
  ): Promise<EventResponse> {
    return this.sendEvent({
      event_name: EventNames.THREAD_REACTION_ADD,
      source_id: this.agentId,
      destination_id: channel ? `channel:${channel}` : undefined,
      payload: {
        target_message_id: messageId,
        reaction_type: reactionType,
        action: "add",
      },
    });
  }

  async removeReaction(
    messageId: string,
    reactionType: string,
    channel?: string
  ): Promise<EventResponse> {
    return this.sendEvent({
      event_name: EventNames.THREAD_REACTION_REMOVE,
      source_id: this.agentId,
      destination_id: channel ? `channel:${channel}` : undefined,
      payload: {
        target_message_id: messageId,
        reaction_type: reactionType,
        action: "remove",
      },
    });
  }

  async getChannelList(): Promise<EventResponse> {
    return this.sendEvent({
      event_name: EventNames.THREAD_CHANNELS_LIST,
      source_id: this.agentId,
      destination_id: "mod:openagents.mods.workspace.messaging",
      payload: {},
    });
  }

  async getChannelMessages(
    channel: string,
    limit: number = 200,
    offset: number = 0
  ): Promise<EventResponse> {
    return this.sendEvent({
      event_name: EventNames.THREAD_CHANNEL_MESSAGES_RETRIEVE,
      source_id: this.agentId,
      destination_id: "mod:openagents.mods.workspace.messaging",
      payload: {
        channel: channel,
        limit: limit,
        offset: offset,
      },
    });
  }

  async getDirectMessages(
    targetAgentId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<EventResponse> {
    return this.sendEvent({
      event_name: EventNames.THREAD_DIRECT_MESSAGES_RETRIEVE,
      source_id: this.agentId,
      destination_id: "mod:openagents.mods.workspace.messaging",
      payload: {
        target_agent_id: targetAgentId,
        limit: limit,
        offset: offset,
      },
    });
  }

  async getNetworkHealth(): Promise<any> {
    try {
      const response = await this.sendHttpRequest("/health", "GET");
      return response.data || {};
    } catch (error) {
      console.error("Failed to get network health:", error);
      return {};
    }
  }

  async getConnectedAgents(): Promise<AgentInfo[]> {
    try {
      const healthData = await this.getNetworkHealth();
      const agents: AgentInfo[] = [];

      if (healthData.agents) {
        for (const [agentId, agentData] of Object.entries(healthData.agents)) {
          agents.push({
            agent_id: agentId,
            metadata: {
              display_name: agentId,
              status: "online", // All agents in health check are online
            },
            last_activity: (agentData as any).last_seen || Date.now(),
          });
        }
      }

      return agents;
    } catch (error) {
      console.error("Failed to get connected agents:", error);
      return [];
    }
  }

  /**
   * Event handling
   */
  on(eventName: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName)!.add(handler);
  }

  off(eventName: string, handler?: EventHandler): void {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      if (handler) {
        handlers.delete(handler);
      } else {
        handlers.clear();
      }
    }
  }

  private emit(eventName: string, data: any): void {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${eventName}:`, error);
        }
      });
    }
  }

  /**
   * Start polling for events
   */
  private startEventPolling(): void {
    this.pollingInterval = setInterval(async () => {
      if (!this.connected || this.connectionAborted) {
        return;
      }

      try {
        await this.pollEvents();
      } catch (error) {
        console.error("Event polling error:", error);
        this.handleReconnect();
      }
    }, 2000); // Poll every 2 seconds
  }

  /**
   * Poll for events from the network
   */
  private async pollEvents(): Promise<void> {
    try {
      const response = await this.sendHttpRequest(
        `/poll?agent_id=${this.agentId}`,
        "GET"
      );

      if (
        response.success &&
        response.messages &&
        Array.isArray(response.messages)
      ) {
        for (const event of response.messages) {
          this.handleIncomingEvent(event);
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle incoming events from the network
   */
  private handleIncomingEvent(event: Event): void {
    try {
      console.log(
        `📨 Received event: ${event.event_name} from source_id: ${event.source_id}`
      );

      // Emit specific event
      this.emit(event.event_name, event);

      // Emit generic 'event' for all events
      this.emit("event", event);

      // Emit legacy 'message' for compatibility
      this.emit("message", event);
    } catch (error) {
      console.error("Error handling incoming event:", error);
    }
  }

  /**
   * Send HTTP request helper
   */
  private async sendHttpRequest(
    endpoint: string,
    method: "GET" | "POST",
    data?: any
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const isPolling = endpoint.includes('/poll?agent_id=');
    
    if (!isPolling) {
      console.log(`🌐 ${method} ${url}`, data ? { body: data } : "");
    }

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(this.timeout),
    };

    if (data && method === "POST") {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ HTTP Error ${response.status}:`, errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      // For polling, only log when there are messages
      if (isPolling) {
        const hasMessages = result.messages && result.messages.length > 0;
        if (hasMessages) {
          console.log(`🌐 ${method} ${url}`);
          console.log(`📡 Response ${response.status} for ${method} ${endpoint}`);
          console.log(`📦 Response data for ${endpoint}:`, result);
        }
      } else {
        console.log(`📡 Response ${response.status} for ${method} ${endpoint}`);
        console.log(`📦 Response data for ${endpoint}:`, result);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ Request failed for ${method} ${url}:`, error);
      throw error;
    }
  }

  /**
   * Generate unique agent ID for conflict resolution
   */
  private generateUniqueAgentId(baseId: string, attempt: number = 1): string {
    if (attempt === 1) {
      return `${baseId}_${Date.now()}`;
    }
    return `${baseId}_${Date.now()}_${attempt}`;
  }

  /**
   * Handle reconnection logic
   */
  private handleReconnect(): void {
    if (this.connectionAborted) {
      console.log("🔄 Connection was manually aborted, skipping reconnect");
      return;
    }

    if (this.isConnecting) {
      console.log("🔄 Already attempting to reconnect, skipping");
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(
        `🔄 Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      this.emit("reconnecting", {
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        delay,
      });

      setTimeout(async () => {
        if (this.connectionAborted || this.connected) {
          return;
        }

        try {
          console.log(
            `🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
          );
          const success = await this.connect();

          if (success) {
            console.log("🔄 ✅ Reconnection successful!");
            this.emit("reconnected", { attempts: this.reconnectAttempts });
          } else {
            console.log("🔄 ❌ Reconnection failed, will retry...");
            this.handleReconnect();
          }
        } catch (error) {
          console.log(
            `🔄 ❌ Reconnection attempt ${this.reconnectAttempts} failed:`,
            error
          );
          this.handleReconnect();
        }
      }, delay);
    } else {
      console.log(
        `🔄 Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`
      );
      this.emit("connectionLost", {
        reason: "Max reconnection attempts reached",
      });
    }
  }

  /**
   * Public getters
   */
  isConnected(): boolean {
    return this.connected;
  }

  getAgentId(): string {
    return this.agentId;
  }

  getOriginalAgentId(): string {
    return this.originalAgentId;
  }

  isUsingModifiedId(): boolean {
    return this.agentId !== this.originalAgentId;
  }
}

/**
 * Event-based Network Service for OpenAgents Studio
 *
 * This service implements event-driven architecture using HTTP transport.
 */

import { HttpEventConnector } from "./eventConnector";
import {
  Event,
  EventResponse,
  EventNames,
  ThreadMessage,
  ThreadChannel,
  AgentInfo,
} from "@/types/events";
import { ConnectionStatusEnum, NetworkConnection } from "@/types/connection";

export interface EventNetworkServiceOptions {
  agentId: string;
  connection: NetworkConnection;
  timeout?: number;
}

export class EventNetworkService {
  private connector: HttpEventConnector;
  private connection: NetworkConnection;
  private agentId: string;
  private eventHandlers: Map<string, Set<Function>> = new Map();

  constructor(options: EventNetworkServiceOptions) {
    this.agentId = options.agentId;
    this.connection = options.connection;

    this.connector = new HttpEventConnector({
      host: this.connection.host,
      port: this.connection.port,
      agentId: this.agentId,
      timeout: options.timeout,
      useHttps: this.connection.useHttps,
      networkId: this.connection.networkId,
    });

    this.setupEventHandlers();
  }

  /**
   * Connect to the network
   */
  async connect(): Promise<boolean> {
    try {
      this.connection.status = ConnectionStatusEnum.CONNECTING;
      this.emit("connectionStatusChanged", this.connection);

      const success = await this.connector.connect();

      if (success) {
        this.connection.status = ConnectionStatusEnum.CONNECTED;
        this.emit("connected", { agentId: this.connector.getAgentId() });
      } else {
        this.connection.status = ConnectionStatusEnum.ERROR;
        this.emit("connectionError", { error: "Failed to connect" });
      }

      this.emit("connectionStatusChanged", this.connection);
      return success;
    } catch (error) {
      this.connection.status = ConnectionStatusEnum.ERROR;
      this.emit("connectionStatusChanged", this.connection);
      this.emit("connectionError", { error });
      return false;
    }
  }

  /**
   * Disconnect from the network
   */
  async disconnect(): Promise<void> {
    await this.connector.disconnect();
    this.connection.status = ConnectionStatusEnum.DISCONNECTED;
    this.emit("connectionStatusChanged", this.connection);
    this.emit("disconnected", { reason: "Manual disconnect" });
  }

  /**
   * Thread messaging operations with immediate EventResponse feedback
   */
  async sendDirectMessage(
    targetAgentId: string,
    content: string
  ): Promise<EventResponse> {
    const response = await this.connector.sendDirectMessage(
      targetAgentId,
      content
    );

    if (response.success) {
      console.log(`✅ Direct message sent to ${targetAgentId} ${content}`);
    } else {
      console.error(
        `❌ Failed to send direct message to ${targetAgentId} ${content}: ${response.message}`
      );
    }

    return response;
  }

  async sendChannelMessage(
    channel: string,
    content: string,
    replyToId?: string
  ): Promise<EventResponse> {
    const response = await this.connector.sendChannelMessage(
      channel,
      content,
      replyToId
    );

    if (response.success) {
      console.log(`✅ Channel message sent to #${channel} ${content}`);
    } else {
      console.error(
        `❌ Failed to send message to #${channel} ${content}: ${response.message}`
      );
    }

    return response;
  }

  async addReaction(
    messageId: string,
    reactionType: string,
    channel?: string
  ): Promise<EventResponse> {
    const response = await this.connector.addReaction(
      messageId,
      reactionType,
      channel
    );

    // Check outer success and inner data.success
    const isSuccess = response.success && response.data?.success !== false;

    if (isSuccess) {
      console.log(`✅ Reaction ${reactionType} added to message ${messageId}`);
    } else {
      console.error(
        `❌ Failed to add reaction: ${response.message || response.data?.message || "Unknown error"
        }`
      );
    }

    // Return corrected success status
    return {
      ...response,
      success: isSuccess,
    };
  }

  async removeReaction(
    messageId: string,
    reactionType: string,
    channel?: string
  ): Promise<EventResponse> {
    const response = await this.connector.removeReaction(
      messageId,
      reactionType,
      channel
    );

    // Check outer success and inner data.success
    const isSuccess = response.success && response.data?.success !== false;

    if (isSuccess) {
      console.log(
        `✅ Reaction ${reactionType} removed from message ${messageId}`
      );
    } else {
      console.error(
        `❌ Failed to remove reaction: ${response.message || response.data?.message || "Unknown error"
        }`
      );
    }

    // Return corrected success status
    return {
      ...response,
      success: isSuccess,
    };
  }

  /**
   * Get channel list - returns immediate EventResponse with data
   */
  async getChannels(): Promise<ThreadChannel[]> {
    try {
      const response = await this.connector.getChannelList();

      if (response.success && response.data?.channels) {
        console.log(`✅ Retrieved ${response.data.channels.length} channels`);
        return response.data.channels;
      } else {
        console.warn("No channels found, providing defaults");
        return this.getDefaultChannels();
      }
    } catch (error) {
      console.error("Error getting channels:", error);
      return this.getDefaultChannels();
    }
  }

  /**
   * Get channel messages - returns immediate EventResponse with data
   */
  async getChannelMessages(
    channel: string,
    limit: number = 200,
    offset: number = 0
  ): Promise<ThreadMessage[]> {
    try {
      const response = await this.connector.getChannelMessages(
        channel,
        limit,
        offset
      );

      if (response.success && response.data?.messages) {
        console.log(
          `✅ Retrieved ${response.data.messages.length} messages from #${channel}`
        );
        return response.data.messages;
      } else {
        console.warn(`No messages found for channel #${channel}`);
        return [];
      }
    } catch (error) {
      console.error(`Error getting messages for channel #${channel}:`, error);
      return [];
    }
  }

  /**
   * Get direct messages - returns immediate EventResponse with data
   */
  async getDirectMessages(
    targetAgentId: string,
    limit: number = 200,
    offset: number = 0
  ): Promise<ThreadMessage[]> {
    try {
      const response = await this.connector.getDirectMessages(
        targetAgentId,
        limit,
        offset
      );

      if (response.success && response.data?.messages) {
        console.log(
          `✅ Retrieved ${response.data.messages.length} direct messages with ${targetAgentId}`
        );

        // Standardize direct messages data format (different from channel messages)
        const standardizedMessages = response.data.messages.map((msg: any) => {
          // Check if it's already in standard ThreadMessage format
          if (msg.sender_id && msg.content && msg.message_type) {
            return msg as ThreadMessage;
          }

          // Convert raw event format to standard ThreadMessage format
          console.log(`🔄 Converting raw direct message event to ThreadMessage:`, msg);

          // Safely extract reactions, checking multiple possible locations and nested structures
          const rawReactions = msg.payload?.reactions ||
            msg.reactions ||
            msg.payload?.metadata?.reactions ||
            msg.metadata?.reactions ||
            {};

          // Convert reactions format: array -> number count
          const reactions: { [key: string]: number } = {};
          if (rawReactions && typeof rawReactions === 'object') {
            Object.entries(rawReactions).forEach(([type, value]) => {
              if (Array.isArray(value)) {
                // If array format (e.g. {laugh: ['SharpUnit2379', 'Krane']}), convert to count
                reactions[type] = value.length;
              } else if (typeof value === 'number') {
                // If already number format, use directly
                reactions[type] = value;
              } else if (typeof value === 'string') {
                // If string, try to parse as number
                const numValue = parseInt(value, 10);
                reactions[type] = isNaN(numValue) ? 1 : numValue;
              }
            });
          }

          // Debug reactions data conversion
          if (Object.keys(rawReactions).length > 0) {
            console.log(`🎭 Converting reactions for message ${msg.event_id}:`);
            console.log(`  Raw reactions:`, rawReactions);
            console.log(`  Converted reactions:`, reactions);
          }

          // Debug complete message structure (only when there are reactions)
          if (Object.keys(rawReactions).length > 0) {
            console.log(`🔍 Full message structure for ${msg.event_id}:`, {
              hasPayload: !!msg.payload,
              hasReactions: !!msg.reactions,
              payloadReactions: msg.payload?.reactions,
              directReactions: msg.reactions,
            });
          }

          // Extract files from content.files
          const files = msg.payload?.content?.files || msg.content?.files || [];

          return {
            message_id: msg.event_id || msg.message_id || `dm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            sender_id: msg.source_id || msg.sender_id || 'unknown',
            timestamp: msg.timestamp
              ? (typeof msg.timestamp === 'number' ?
                (msg.timestamp < 10000000000 ? msg.timestamp * 1000 : msg.timestamp).toString()
                : msg.timestamp)
              : Date.now().toString(),
            content: {
              text: msg.payload?.content?.text || msg.content?.text || '',
              files: files.length > 0 ? files : undefined,
            },
            message_type: 'direct_message' as const,
            target_agent_id: msg.payload?.target_agent_id || msg.target_agent_id || targetAgentId,
            reply_to_id: msg.payload?.reply_to_id || msg.reply_to_id,
            thread_level: msg.payload?.thread_level || msg.thread_level || 1,
            quoted_message_id: msg.payload?.quoted_message_id || msg.quoted_message_id,
            quoted_text: msg.payload?.quoted_text || msg.quoted_text,
            reactions: reactions,
            // Keep original data for debugging
            payload: msg.payload,
            source_id: msg.source_id
          } as ThreadMessage;
        });

        console.log(`🔄 Standardized ${standardizedMessages.length} direct messages`);
        return standardizedMessages;
      } else {
        console.warn(`No direct messages found with ${targetAgentId}`);
        return [];
      }
    } catch (error) {
      console.error(
        `Error getting direct messages with ${targetAgentId}:`,
        error
      );
      return [];
    }
  }

  /**
   * Get connected agents from health check
   */
  async getConnectedAgents(): Promise<AgentInfo[]> {
    try {
      const agents = await this.connector.getConnectedAgents();
      console.log(`✅ Retrieved ${agents.length} connected agents`);
      return agents;
    } catch (error) {
      console.error("Error getting connected agents:", error);
      return [];
    }
  }

  /**
   * Legacy compatibility methods for existing components
   */
  async sendMessage(
    content: string,
    channel?: string,
    targetAgentId?: string,
    replyToId?: string
  ): Promise<boolean> {
    try {
      let response: EventResponse;

      if (channel) {
        response = await this.sendChannelMessage(channel, content, replyToId);
      } else if (targetAgentId) {
        response = await this.sendDirectMessage(targetAgentId, content);
      } else {
        throw new Error("Either channel or targetAgentId must be provided");
      }

      return response.success;
    } catch (error) {
      console.error("Error sending message:", error);
      return false;
    }
  }

  async reactToMessage(
    messageId: string,
    reactionType: string,
    action: "add" | "remove" = "add",
    channel?: string
  ): Promise<boolean> {
    try {
      const response =
        action === "add"
          ? await this.addReaction(messageId, reactionType, channel)
          : await this.removeReaction(messageId, reactionType, channel);

      return response.success;
    } catch (error) {
      console.error("Error reacting to message:", error);
      return false;
    }
  }

  /**
   * Send a generic event (for Forum and other custom functionality)
   */
  async sendEvent(event: Event): Promise<EventResponse> {
    console.log(`📤 Sending custom event: ${event.event_name}`);
    return await this.connector.sendEvent(event);
  }

  // Legacy methods that emit events (for backward compatibility)
  async listChannels(): Promise<void> {
    const channels = await this.getChannels();
    this.emit("channels", channels);
  }

  async retrieveChannelMessages(
    channelName: string,
    limit: number = 200,
    offset: number = 0
  ): Promise<void> {
    const messages = await this.getChannelMessages(channelName, limit, offset);
    this.emit("channel_messages", {
      channel: channelName,
      messages,
      total_count: messages.length,
    });
  }

  async retrieveDirectMessages(
    targetAgentId: string,
    limit: number = 200,
    offset: number = 0
  ): Promise<void> {
    const messages = await this.getDirectMessages(targetAgentId, limit, offset);
    this.emit("direct_messages", {
      target_agent_id: targetAgentId,
      messages,
      total_count: messages.length,
    });
  }

  /**
   * Event handling
   */
  on(eventName: string, handler: Function): void {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName)!.add(handler);
  }

  off(eventName: string, handler?: Function): void {
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
   * Setup event handlers for the connector
   */
  private setupEventHandlers(): void {
    // Connection events
    this.connector.on("connected", (data) => {
      this.emit("connected", data);
    });

    this.connector.on("disconnected", (data) => {
      this.emit("disconnected", data);
    });

    this.connector.on("connectionError", (data) => {
      this.emit("connectionError", data);
    });

    this.connector.on("reconnecting", (data) => {
      this.emit("reconnecting", data);
    });

    this.connector.on("reconnected", (data) => {
      this.emit("reconnected", data);
    });

    // Thread messaging events
    this.connector.on(
      EventNames.THREAD_DIRECT_MESSAGE_NOTIFICATION,
      (event: Event) => {
        const message = this.parseThreadMessage(event);
        if (message) {
          this.emit("directMessage", message);
          this.emit("message", message); // Legacy compatibility
        }
      }
    );

    this.connector.on(
      EventNames.THREAD_CHANNEL_MESSAGE_NOTIFICATION,
      (event: Event) => {
        const message = this.parseThreadMessage(event);
        if (message) {
          this.emit("channelMessage", message);
          this.emit("message", message); // Legacy compatibility
        }
      }
    );

    this.connector.on(EventNames.THREAD_REPLY_NOTIFICATION, (event: Event) => {
      const message = this.parseThreadMessage(event);
      if (message) {
        // Only emit as replyMessage to prevent duplicate processing
        // The openAgentsService will handle converting this to channelMessage for UI
        this.emit("replyMessage", message);
      }
    });

    this.connector.on(
      EventNames.THREAD_REACTION_NOTIFICATION,
      (event: Event) => {
        console.log(`📨 THREAD_REACTION_NOTIFICATION: `, event);
        if (event.payload) {
          this.emit("reaction", {
            message_id: event.payload.target_message_id,
            reaction_type: event.payload.reaction_type,
            action: event.payload.action,
            user_id: event.payload.reacting_agent,
            total_reactions: event.payload.total_reactions,
          });
        }
      }
    );

    // Handle all events for debugging
    this.connector.on("event", (event: Event) => {
      console.log(`📨 Network event received: ${event.event_name}`, event);
      this.emit("rawEvent", event);
    });
  }

  /**
   * Parse thread message from event payload (updated for new payload structure)
   */
  private parseThreadMessage(event: Event): ThreadMessage | null {
    try {
      const payload = event.payload;
      if (!payload) {
        return null;
      }

      console.log(`🔍 Parsing thread message:`, {
        eventId: event.event_id,
        sourceId: event.source_id,
        eventName: event.event_name,
        payload: payload,
      });

      // Extract text content and files from the payload
      const textContent = payload.content?.text || "";
      const files = payload.content?.files;

      return {
        message_id: event.event_id || "",
        sender_id: event.source_id,
        timestamp: event.timestamp
          ? new Date(event.timestamp * 1000).toISOString()
          : new Date().toISOString(),
        content: {
          text: textContent,
          files: files,
        },
        message_type: payload.message_type || "channel_message",
        channel: payload.channel,
        target_agent_id: payload.target_agent_id,
        reply_to_id: payload.reply_to_id,
        thread_level: payload.thread_level || 1,
        quoted_message_id: payload.quoted_message_id,
        quoted_text: payload.quoted_text,
        thread_info: payload.thread_info,
        reactions: payload.reactions,
      };
    } catch (error) {
      console.error("Error parsing thread message:", error);
      return null;
    }
  }

  /**
   * Get default channels if backend doesn't provide any
   */
  private getDefaultChannels(): ThreadChannel[] {
    return [
      {
        name: "general",
        description: "General discussion",
        agents: [],
        message_count: 0,
        thread_count: 0,
      },
      {
        name: "development",
        description: "Development discussions",
        agents: [],
        message_count: 0,
        thread_count: 0,
      },
      {
        name: "support",
        description: "Support and help",
        agents: [],
        message_count: 0,
        thread_count: 0,
      },
    ];
  }

  /**
   * Public getters
   */
  isConnected(): boolean {
    return this.connector.isConnected();
  }

  getAgentId(): string {
    return this.connector.getAgentId();
  }

  getOriginalAgentId(): string {
    return this.connector.getOriginalAgentId();
  }

  isUsingModifiedId(): boolean {
    return this.connector.isUsingModifiedId();
  }

  getConnection(): NetworkConnection {
    return this.connection;
  }
}

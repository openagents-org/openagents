/**
 * HTTP Event Connector for OpenAgents Studio
 *
 * This connector implements the new event-driven architecture using HTTP transport.
 * It provides immediate EventResponse feedback via HTTP transport.
 */

import { clearAllOpenAgentsDataForLogout } from "@/utils/cookies";
import { Event, EventResponse, EventNames, AgentInfo } from "../types/events";
import {
  networkFetch,
} from "../utils/httpClient";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { toast } from "sonner";
import { eventLogService } from "./eventLogService";
import { NETWORK_CONFIG } from "@/constants/appConfig";
import { eventLogger } from "@/utils/logger";

export interface ConnectionOptions {
  host: string;
  port: number;
  agentId: string;
  metadata?: any;
  timeout?: number;
  passwordHash?: string | null;
  agentGroup?: string | null;
  useHttps?: boolean; // HTTPS Feature: Add useHttps option for HTTPS connections
  networkId?: string; // Network ID for routing through network.openagents.org
}

export interface EventHandler {
  (event: Event): void;
}

export class HttpEventConnector {
  // Static registry to ensure singleton behavior per agent connection
  // This prevents multiple connector instances from fighting over the same agent_id's secret
  private static activeConnectors: Map<string, HttpEventConnector> = new Map();

  private agentId: string;
  private originalAgentId: string;
  private baseUrl: string;
  private host: string;
  private port: number;
  private useHttps: boolean; // HTTPS Feature: Store whether to use HTTPS
  private networkId?: string; // Network ID for routing through network.openagents.org
  private connected = false;
  private isConnecting = false;
  private connectionAborted = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = NETWORK_CONFIG.MAX_RECONNECT_ATTEMPTS;
  private timeout: number;
  private secret: string | null = null;
  private passwordHash: string | null = null;
  private agentGroup: string | null = null;
  private isReregistering = false; // Flag to prevent concurrent re-registration attempts
  private reregisterPromise: Promise<boolean> | null = null; // Promise for concurrent callers to wait on
  private instanceId: string; // Unique ID for this connector instance (for debugging)
  private registryKey: string; // Key used in the static registry

  /**
   * Get an existing connector instance or create a new one.
   * This is the recommended way to get a connector - it ensures singleton behavior
   * and prevents multiple connectors from fighting over the same agent's secret.
   */
  static getInstance(options: ConnectionOptions): HttpEventConnector {
    const key = HttpEventConnector.generateRegistryKey(options);
    const existing = HttpEventConnector.activeConnectors.get(key);

    if (existing && !existing.connectionAborted) {
      eventLogger.info(`♻️ Reusing existing connector for ${options.agentId} (instance: ${existing.instanceId})`);
      // Update credentials if they changed (e.g., after login)
      if (options.passwordHash !== existing.passwordHash) {
        eventLogger.info(`🔑 Password hash changed, will re-authenticate on next request`);
        existing.passwordHash = options.passwordHash || null;
        existing.secret = null; // Clear secret to force re-registration
      }
      if (options.agentGroup !== existing.agentGroup) {
        existing.agentGroup = options.agentGroup || null;
      }
      return existing;
    }

    // Clean up old connector if it exists but was aborted
    if (existing) {
      eventLogger.info(`🧹 Cleaning up aborted connector for ${options.agentId}`);
      HttpEventConnector.activeConnectors.delete(key);
    }

    // Create new connector and register it
    const connector = new HttpEventConnector(options);
    HttpEventConnector.activeConnectors.set(key, connector);
    eventLogger.info(`🆕 Created new connector for ${options.agentId} (instance: ${connector.instanceId})`);
    return connector;
  }

  /**
   * Generate a unique key for the registry based on connection parameters
   */
  private static generateRegistryKey(options: ConnectionOptions): string {
    return `${options.host}:${options.port}:${options.agentId}`;
  }

  /**
   * Clear all active connectors (useful for logout/cleanup)
   */
  static clearAllConnectors(): void {
    eventLogger.info(`🧹 Clearing all ${HttpEventConnector.activeConnectors.size} active connectors`);
    for (const [key, connector] of HttpEventConnector.activeConnectors) {
      connector.disconnect().catch(err => eventLogger.warn(`Error disconnecting ${key}:`, err));
    }
    HttpEventConnector.activeConnectors.clear();
  }

  constructor(options: ConnectionOptions) {
    this.agentId = options.agentId;
    this.originalAgentId = options.agentId;
    this.timeout = options.timeout || 30000;
    this.passwordHash = options.passwordHash || null;
    this.agentGroup = options.agentGroup || null;
    this.useHttps = options.useHttps || false; // HTTPS Feature: Get useHttps option from connection options
    this.networkId = options.networkId; // Network ID for routing through network.openagents.org
    this.instanceId = Math.random().toString(36).substring(2, 8); // Short unique ID for debugging
    this.registryKey = HttpEventConnector.generateRegistryKey(options);

    // HTTPS Feature: Construct baseUrl based on useHttps option
    const protocol = this.useHttps ? 'https' : 'http';
    this.baseUrl = `${protocol}://${options.host}:${options.port}/api`;
    this.host = options.host;
    this.port = options.port;
  }

  /**
   * Connect to the OpenAgents network
   */
  async connect(retryWithUniqueId: boolean = true): Promise<boolean> {
    try {
      if (this.isConnecting) {
        eventLogger.warn("⚠️ Connection attempt ignored - already connecting");
        return false;
      }

      this.connectionAborted = false;
      this.isConnecting = true;

      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }

      eventLogger.info(`🔌 Connecting to OpenAgents network...`);
      eventLogger.info(`🌐 Target: ${this.baseUrl}`);
      eventLogger.info(`👤 Agent: ${this.agentId}`);

      // Health check
      eventLogger.debug(`📡 Sending health check to ${this.baseUrl}/api/health`);
      const healthResponse = await this.sendHttpRequest("/api/health", "GET");
      eventLogger.debug("📡 Health check response:", healthResponse);
      if (!healthResponse.success) {
        throw new Error(
          `Health check failed: ${healthResponse.message || "Unknown error"}`
        );
      }

      // Register agent
      eventLogger.debug(`📡 Sending registration to ${this.baseUrl}/api/register`);
      const registerResponse = await this.sendHttpRequest(
        "/api/register",
        "POST",
        {
          agent_id: this.agentId,
          metadata: {
            display_name: this.agentId,
            user_agent: navigator.userAgent,
            platform: "web",
          },
          password_hash: this.passwordHash || undefined,
          agent_group: this.agentGroup || undefined,
        }
      );

      eventLogger.debug("📡 Registration response:", registerResponse);
      if (!registerResponse.success) {
        throw new Error(
          registerResponse.error_message || "Registration failed"
        );
      }

      // Store authentication secret from registration response
      if (registerResponse.secret) {
        this.secret = registerResponse.secret;
        eventLogger.info("🔑 Authentication secret received and stored");
      } else {
        eventLogger.warn("⚠️ No authentication secret received from network");
      }

      this.connected = true;
      this.reconnectAttempts = 0;
      this.isConnecting = false;

      // Start polling for events
      this.startEventPolling();

      eventLogger.info("✅ Connected to OpenAgents network successfully");
      this.emit("connected", { agentId: this.agentId });

      return true;
    } catch (error: any) {
      eventLogger.error("❌ Connection failed:", error);
      this.isConnecting = false;

      // Handle agent ID conflicts
      if (error.message?.includes("agent_id_conflict") && retryWithUniqueId) {
        eventLogger.info("🔄 Agent ID conflict detected, generating unique ID...");
        this.agentId = this.generateUniqueAgentId(this.originalAgentId);
        eventLogger.info(`🆔 New agent ID: ${this.agentId}`);
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
    eventLogger.info(`🔌 Disconnecting from OpenAgents network... (instance: ${this.instanceId})`);

    this.connectionAborted = true;
    this.connected = false;
    const secretToUse = this.secret; // Store before clearing
    this.secret = null; // Clear authentication secret

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // Remove from the static registry
    HttpEventConnector.activeConnectors.delete(this.registryKey);
    eventLogger.info(`🗑️ Removed connector from registry (instance: ${this.instanceId})`);

    try {
      await this.sendHttpRequest("/api/unregister", "POST", {
        agent_id: this.agentId,
        secret: secretToUse,
      });
    } catch (error) {
      // Don't log unregister errors as errors since they often happen during cleanup
      eventLogger.warn(
        "Failed to unregister agent (this is usually harmless):",
        error
      );
    }

    this.emit("disconnected", { reason: "Manual disconnect" });
  }

  /**
   * Re-register with the network to get a new valid secret.
   * Called when authentication fails due to stale secrets (e.g., after network hot reload).
   *
   * This method handles concurrent calls by sharing a single promise - if multiple
   * requests fail with auth errors simultaneously, they all wait for the same
   * re-registration to complete.
   */
  private async reregister(): Promise<boolean> {
    // If already re-registering, return the existing promise so callers wait for the same result
    if (this.isReregistering && this.reregisterPromise) {
      eventLogger.debug("🔄 Already re-registering, waiting for existing re-registration to complete...");
      return this.reregisterPromise;
    }

    this.isReregistering = true;
    eventLogger.debug("🔄 Re-registering with network to refresh authentication secret...");

    // Create the re-registration promise
    this.reregisterPromise = this.doReregister();

    try {
      return await this.reregisterPromise;
    } finally {
      // Clean up after re-registration completes
      this.isReregistering = false;
      this.reregisterPromise = null;
    }
  }

  /**
   * Internal method that performs the actual re-registration.
   */
  private async doReregister(): Promise<boolean> {
    try {
      // Clear old secret
      this.secret = null;

      // Register agent again
      const registerResponse = await this.sendHttpRequest(
        "/api/register",
        "POST",
        {
          agent_id: this.agentId,
          metadata: {
            display_name: this.agentId,
            user_agent: navigator.userAgent,
            platform: "web",
          },
          password_hash: this.passwordHash || undefined,
          agent_group: this.agentGroup || undefined,
        }
      );

      if (!registerResponse.success) {
        eventLogger.error("❌ Re-registration failed:", registerResponse.error_message);
        return false;
      }

      // Store new authentication secret
      if (registerResponse.secret) {
        this.secret = registerResponse.secret;
        eventLogger.debug("🔑 New authentication secret received and stored");
      } else {
        eventLogger.warn("⚠️ No authentication secret received from re-registration");
      }

      eventLogger.debug("✅ Re-registration successful");
      return true;
    } catch (error) {
      eventLogger.error("❌ Re-registration error:", error);
      return false;
    }
  }

  /**
   * Check if an error response indicates authentication failure that can be recovered by re-registration
   */
  private isAuthenticationError(response: any): boolean {
    if (response.success) return false;

    // Check both 'message' (from send_event) and 'error_message' (from poll) fields
    const errorMessage = response.message || response.error_message || "";
    return errorMessage.includes("Authentication failed");
  }

  /**
   * Get the authentication secret for this connection
   */
  getSecret(): string | null {
    return this.secret;
  }

  /**
   * Get the network host
   */
  getHost(): string {
    return this.host;
  }

  /**
   * Get the network port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the base URL for API requests
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Wait for connection to be established with timeout
   */
  private async waitForConnection(timeoutMs: number = NETWORK_CONFIG.DEFAULT_TIMEOUT): Promise<boolean> {
    if (this.connected) return true;

    const startTime = Date.now();
    const checkInterval = NETWORK_CONFIG.CONNECTION_CHECK_INTERVAL;

    while (Date.now() - startTime < timeoutMs) {
      if (this.connected) return true;
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    return this.connected;
  }

  /**
   * Send an event to the network and get immediate EventResponse
   */
  async sendEvent(event: Event, isRetry: boolean = false): Promise<EventResponse> {
    // Wait for connection if not yet connected (handles race condition after login)
    if (!this.connected) {
      eventLogger.debug(`⏳ Waiting for connection before sending event: ${event.event_name}`);
      const connected = await this.waitForConnection(5000);
      if (!connected) {
        eventLogger.warn(`Agent ${this.agentId} is not connected to network after waiting`);
        return {
          success: false,
          message: "Agent is not connected to network",
        };
      }
      eventLogger.debug(`✅ Connection established, proceeding with event: ${event.event_name}`);
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

      // Add authentication secret (use current secret, may have been refreshed)
      event.secret = this.secret || "";

      eventLogger.debug(
        `📤 Sending event: ${event.event_name} from ${event.source_id}`
      );

      const response = await this.sendHttpRequest("/api/send_event", "POST", {
        event_id: event.event_id,
        event_name: event.event_name,
        source_id: event.source_id,
        target_agent_id: event.destination_id,
        payload: event.payload || {},
        metadata: event.metadata || {},
        visibility: event.visibility || "network",
        secret: event.secret || "",
      });

      const eventResponse: EventResponse = {
        success: response.success,
        message: response.message,
        data: response.data,
        event_name: event.event_name,
      };

      // Handle authentication failure - try to re-register and retry once
      if (this.isAuthenticationError(eventResponse) && !isRetry) {
        eventLogger.debug("🔄 Authentication failed, attempting to re-register...");
        const reregistered = await this.reregister();
        if (reregistered) {
          eventLogger.debug("🔄 Retrying event after re-registration...");
          return this.sendEvent(event, true);
        }
      }

      if (eventResponse.success) {
        eventLogger.debug(`✅ Event sent successfully: ${event.event_name}`);
      } else {
        eventLogger.error(
          `❌ Event failed: ${event.event_name} - ${eventResponse.message}`
        );
      }

      // Log to event log
      eventLogService.logSentEvent(event, eventResponse);

      return eventResponse;
    } catch (error: any) {
      const errorMessage = `Failed to send event ${event.event_name}: ${error.message}`;
      eventLogger.error(errorMessage);

      const errorResponse: EventResponse = {
        success: false,
        message: errorMessage,
        event_name: event.event_name,
      };

      // Log failed event to log
      eventLogService.logSentEvent(event, errorResponse);

      return errorResponse;
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
        content: { text: content },
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
      content: { text: content },
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
    limit: number = 200,
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

  async getConversationsList(): Promise<EventResponse> {
    return this.sendEvent({
      event_name: EventNames.THREAD_CONVERSATIONS_LIST,
      source_id: this.agentId,
      destination_id: "mod:openagents.mods.workspace.messaging",
      payload: {},
    });
  }

  async getChannelAnnouncement(channel: string): Promise<EventResponse> {
    return this.sendEvent({
      event_name: "thread.announcement.get",
      source_id: this.agentId,
      // destination_id: "mod:openagents.mods.workspace.messaging",
      payload: { channel },
    });
  }

  async getNetworkHealth(): Promise<any> {
    try {
      const response = await this.sendHttpRequest("/api/health", "GET");
      return response.data || {};
    } catch (error) {
      eventLogger.error("Failed to get network health:", error);
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
      eventLogger.error("Failed to get connected agents:", error);
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

  removeAllListeners(): void {
    this.eventHandlers.clear();
  }

  private emit(eventName: string, data: any): void {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          eventLogger.error(`Error in event handler for ${eventName}:`, error);
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
        eventLogger.error("Event polling error:", error);
        this.handleReconnect();
      }
    }, 2000); // Poll every 2 seconds
  }

  /**
   * Poll for events from the network
   */
  private async pollEvents(): Promise<void> {
    try {
      // Include secret in polling request if available
      const secretParam = this.secret
        ? `&secret=${encodeURIComponent(this.secret)}`
        : "";
      const response = await this.sendHttpRequest(
        `/api/poll?agent_id=${this.agentId}${secretParam}`,
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
      } else {
        // Handle authentication failure - re-register to get new secret
        if (this.isAuthenticationError(response)) {
          eventLogger.debug("🔄 Polling authentication failed, attempting to re-register...");
          const reregistered = await this.reregister();
          if (reregistered) {
            eventLogger.debug("🔄 Re-registration successful, polling will resume with new secret");
          } else {
            eventLogger.warn("⚠️ Re-registration failed during polling, will retry on next poll");
          }
          return;
        }

        // when kick off need login again
        if (
          !response.success &&
          response.error_message === "Agent not registered"
        ) {
          toast.error("You have been kicked from network, please login again", {
            description: "You will be redirected to network selection",
          });
          // const timer = setTimeout(() => {
          // clearTimeout(timer);
          // Clear network state
          useAuthStore.getState().clearNetwork();
          useAuthStore.getState().clearAgentName();
          useAuthStore.getState().clearAgentGroup(); // Clear agent group
          useAuthStore.getState().clearPasswordHash(); // Explicitly clear password hash
          eventLogger.debug("🧹 Network state, agent group and password hash cleared");

          // Clear chat store data
          useChatStore.getState().clearAllChatData();
          eventLogger.debug("🧹 Chat store data cleared");

          // Clear all OpenAgents-related data (preserve theme settings)
          clearAllOpenAgentsDataForLogout();

          // Navigate to network selection page
          eventLogger.debug("🔄 Navigating to network selection");
          // }, 1000);
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
      eventLogger.debug(
        `📨 Received event: ${event.event_name} from source_id: ${event.source_id}`
      );

      // Log to event log
      eventLogService.logReceivedEvent(event);

      // Emit specific event
      this.emit(event.event_name, event);

      this.emit("rawEvent", event);

      // Emit generic 'event' for all events
      this.emit("event", event);

      // Emit legacy 'message' for compatibility
      this.emit("message", event);
    } catch (error) {
      eventLogger.error("Error handling incoming event:", error);
    }
  }

  /**
   * Send HTTP request helper with proxy support
   * HTTPS Feature: Use useHttps parameter to construct request
   */
  private async sendHttpRequest(
    endpoint: string,
    method: "GET" | "POST",
    data?: any
  ): Promise<any> {
    const isPolling = endpoint.includes("/api/poll?agent_id=");

    if (!isPolling) {
      eventLogger.debug(`🌐 ${method} ${endpoint}`, data ? { body: data } : "");
    }

    // HTTPS Feature: Pass useHttps parameter to networkFetch
    // Network ID: Pass networkId for routing through network.openagents.org
    const options: RequestInit & { timeout?: number; useHttps?: boolean; networkId?: string } = {
      method,
      timeout: this.timeout,
      useHttps: this.useHttps, // HTTPS Feature: Use instance's useHttps property
      networkId: this.networkId, // Network ID for routing through network.openagents.org
    };

    if (data && method === "POST") {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await networkFetch(
        this.host,
        this.port,
        endpoint,
        options
      );

      if (!response.ok) {
        const errorText = await response.text();
        eventLogger.error(`❌ HTTP Error ${response.status}:`, errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      // For polling, only log when there are messages
      if (isPolling) {
        const hasMessages = result.messages && result.messages.length > 0;
        if (hasMessages) {
          eventLogger.debug(`🌐 ${method} ${endpoint}`);
          eventLogger.debug(
            `📡 Response ${response.status} for ${method} ${endpoint}`
          );
          eventLogger.debug(`📦 Response data for ${endpoint}:`, result);
        }
      } else {
        eventLogger.debug(`📡 Response ${response.status} for ${method} ${endpoint}`);
        eventLogger.debug(`📦 Response data for ${endpoint}:`, result);
      }

      return result;
    } catch (error) {
      eventLogger.error(`❌ Request failed for ${method} ${endpoint}:`, error);
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
      eventLogger.debug("🔄 Connection was manually aborted, skipping reconnect");
      return;
    }

    if (this.isConnecting) {
      eventLogger.debug("🔄 Already attempting to reconnect, skipping");
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      eventLogger.debug(
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
          eventLogger.debug(
            `🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
          );
          const success = await this.connect();

          if (success) {
            eventLogger.debug("🔄 ✅ Reconnection successful!");
            this.emit("reconnected", { attempts: this.reconnectAttempts });
          } else {
            eventLogger.debug("🔄 ❌ Reconnection failed, will retry...");
            this.handleReconnect();
          }
        } catch (error) {
          eventLogger.debug(
            `🔄 ❌ Reconnection attempt ${this.reconnectAttempts} failed:`,
            error
          );
          this.handleReconnect();
        }
      }, delay);
    } else {
      eventLogger.debug(
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

  isCurrentlyConnecting(): boolean {
    return this.isConnecting;
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

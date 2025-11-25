import { toast } from 'sonner';
import { clearAllOpenAgentsDataForLogout } from '../utils/cookies';
import { Event, EventResponse, EventNames, AgentInfo } from '../types/events';
import { networkFetch } from '../utils/httpClient';
import { useAuthStore } from '../stores/authStore';

export interface ConnectionOptions {
  host: string;
  port: number;
  agentId: string;
  metadata?: any;
  timeout?: number;
  passwordHash?: string | null;
}

export interface EventHandler {
  (event: Event): void;
}

export class HttpEventConnector {
  private agentId: string;
  private originalAgentId: string;
  private baseUrl: string;
  private host: string;
  private port: number;
  private connected = false;
  private isConnecting = false;
  private connectionAborted = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private timeout: number;
  private secret: string | null = null;
  private passwordHash: string | null = null;

  constructor(options: ConnectionOptions) {
    this.agentId = options.agentId;
    this.originalAgentId = options.agentId;
    this.timeout = options.timeout || 30000;
    this.passwordHash = options.passwordHash || null;

    this.baseUrl = `http://${options.host}:${options.port}/api`;
    this.host = options.host;
    this.port = options.port;
  }

  async connect(retryWithUniqueId: boolean = true): Promise<boolean> {
    try {
      if (this.isConnecting) {
        console.log('⚠️ Connection attempt ignored - already connecting');
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

      const healthResponse = await this.sendHttpRequest('/api/health', 'GET');
      if (!healthResponse.success) {
        throw new Error(
          `Health check failed: ${healthResponse.message || 'Unknown error'}`
        );
      }

      const registerResponse = await this.sendHttpRequest(
        '/api/register',
        'POST',
        {
          agent_id: this.agentId,
          metadata: {
            display_name: this.agentId,
            user_agent: navigator.userAgent,
            platform: 'web',
          },
          password_hash: this.passwordHash || undefined,
        }
      );

      if (!registerResponse.success) {
        throw new Error(
          registerResponse.error_message || 'Registration failed'
        );
      }

      if (registerResponse.secret) {
        this.secret = registerResponse.secret;
      } else {
        console.warn('⚠️ No authentication secret received from network');
      }

      this.connected = true;
      this.reconnectAttempts = 0;
      this.isConnecting = false;

      this.startEventPolling();

      this.emit('connected', { agentId: this.agentId });

      return true;
    } catch (error: any) {
      console.error('❌ Connection failed:', error);
      this.isConnecting = false;

      if (error.message?.includes('agent_id_conflict') && retryWithUniqueId) {
        console.log('🔄 Agent ID conflict detected, generating unique ID...');
        this.agentId = this.generateUniqueAgentId(this.originalAgentId);
        console.log(`🆔 New agent ID: ${this.agentId}`);
        return this.connect(false);
      }

      this.emit('connectionError', { error: error.message });
      this.handleReconnect();
      return false;
    }
  }

  async disconnect(): Promise<void> {
    console.log('🔌 Disconnecting from OpenAgents network...');

    this.connectionAborted = true;
    this.connected = false;
    const secret = this.secret;
    this.secret = null;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    try {
      await this.sendHttpRequest('/api/unregister', 'POST', {
        agent_id: this.agentId,
        secret: secret,
      });
    } catch (error) {
      console.warn(
        'Failed to unregister agent (this is usually harmless):',
        error
      );
    }

    this.emit('disconnected', { reason: 'Manual disconnect' });
  }

  async sendEvent(event: Event): Promise<EventResponse> {
    if (!this.connected) {
      console.warn(`Agent ${this.agentId} is not connected to network`);
      return {
        success: false,
        message: 'Agent is not connected to network',
      };
    }

    try {
      if (!event.source_id) {
        event.source_id = this.agentId;
      }

      if (!event.event_id) {
        event.event_id = `${this.agentId}_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
      }

      if (!event.timestamp) {
        event.timestamp = Math.floor(Date.now() / 1000);
      }

      if (!event.secret && this.secret) {
        event.secret = this.secret;
      }

      const response = await this.sendHttpRequest('/api/send_event', 'POST', {
        event_id: event.event_id,
        event_name: event.event_name,
        source_id: event.source_id,
        target_agent_id: event.destination_id,
        payload: event.payload || {},
        metadata: event.metadata || {},
        visibility: event.visibility || 'network',
        secret: event.secret || '',
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

  async getChannelAnnouncement(channel: string): Promise<EventResponse> {
    return this.sendEvent({
      event_name: EventNames.THREAD_ANNOUNCEMENT_GET,
      source_id: this.agentId,
      payload: { channel },
    });
  }

  async getNetworkHealth(): Promise<any> {
    try {
      const response = await this.sendHttpRequest('/api/health', 'GET');
      return response.data || {};
    } catch (error) {
      console.error('Failed to get network health:', error);
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
              status: 'online',
            },
            last_activity: (agentData as any).last_seen || Date.now().toString(),
          });
        }
      }

      return agents;
    } catch (error) {
      console.error('Failed to get connected agents:', error);
      return [];
    }
  }

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
          console.error(`Error in event handler for ${eventName}:`, error);
        }
      });
    }
  }

  private startEventPolling(): void {
    this.pollingInterval = setInterval(async () => {
      if (!this.connected || this.connectionAborted) {
        return;
      }

      try {
        await this.pollEvents();
      } catch (error) {
        console.error('Event polling error:', error);
        this.handleReconnect();
      }
    }, 2000);
  }

  private async pollEvents(): Promise<void> {
    try {
      const secretParam = this.secret
        ? `&secret=${encodeURIComponent(this.secret)}`
        : '';
      const response = await this.sendHttpRequest(
        `/api/poll?agent_id=${this.agentId}${secretParam}`,
        'GET'
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
        if (
          !response.success &&
          response.error_message === 'Agent not registered'
        ) {
          toast.error('You have been kicked from network, please login again', {
            description: 'You will be redirected to network selection',
          });
          useAuthStore.getState().clearNetwork();
          useAuthStore.getState().clearAgentName();
          useAuthStore.getState().clearPasswordHash();

          clearAllOpenAgentsDataForLogout();
        }
      }
    } catch (error) {
      console.error('Failed to poll events:', error);
      throw error;
    }
  }

  private handleIncomingEvent(event: any): void {
    if (!event || !event.event_name) {
      console.warn('Received malformed event:', event);
      return;
    }

    this.emit(event.event_name, event);
    this.emit('rawEvent', event);
  }

  private async sendHttpRequest(
    path: string,
    method: 'GET' | 'POST',
    body?: any
  ): Promise<any> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    return networkFetch(
      this.host,
      this.port,
      path.startsWith('/') ? path : `/${path}`,
      {
        method,
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      }
    ).then((response) => response.json());
  }

  private handleReconnect(): void {
    if (this.connectionAborted) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('connectionError', {
        error: 'Maximum reconnect attempts reached',
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(5000 * this.reconnectAttempts, 20000);

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
    });

    setTimeout(() => {
      if (!this.connectionAborted) {
        this.connect(false);
      }
    }, delay);
  }

  private generateUniqueAgentId(baseId: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${baseId}_${timestamp}_${random}`;
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


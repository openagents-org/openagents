/**
 * Relay Service
 *
 * Manages WebSocket connection to the OpenAgents relay server,
 * enabling localhost networks to be accessible publicly.
 */

export interface RelayConfig {
  relayUrl: string;
  networkId: string;
  networkName?: string;
  localHost: string;
  localPort: number;
  useHttps?: boolean;
}

export interface RelayConnection {
  networkId: string;
  tunnelId?: string;
  token: string;
  relayUrl: string;
  publicUrl: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
}

export interface RelayStatus {
  online: boolean;
  connectedNetworks: number;
  uptime: number;
}

type MessageHandler = (message: any) => void;
type StatusHandler = (status: RelayConnection['status'], error?: string) => void;

const DEFAULT_RELAY_URL = 'wss://relay.openagents.org';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

class RelayClient {
  private ws: WebSocket | null = null;
  private config: RelayConfig | null = null;
  private token: string | null = null;
  private tunnelId: string | null = null;
  private publicUrl: string | null = null;
  private status: RelayConnection['status'] = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private statusHandlers: Set<StatusHandler> = new Set();
  private pendingRequests: Map<string, { resolve: (response: any) => void; reject: (error: Error) => void }> = new Map();

  /**
   * Connect to the relay server
   */
  async connect(config: RelayConfig): Promise<RelayConnection> {
    this.config = config;
    this.reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      try {
        this.updateStatus('connecting');

        // Parse relay URL - support both http and ws protocols
        let wsUrl = config.relayUrl || DEFAULT_RELAY_URL;
        if (wsUrl.startsWith('http://')) {
          wsUrl = wsUrl.replace('http://', 'ws://');
        } else if (wsUrl.startsWith('https://')) {
          wsUrl = wsUrl.replace('https://', 'wss://');
        }

        // Ensure we connect to the /register endpoint
        if (!wsUrl.endsWith('/register')) {
          wsUrl = wsUrl.replace(/\/$/, '') + '/register';
        }

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[Relay] Connected to relay server');

          // Send registration message
          this.ws!.send(JSON.stringify({
            type: 'register',
            network_id: config.networkId,
            info: {
              name: config.networkName || config.networkId,
              host: config.localHost,
              port: config.localPort,
            },
          }));
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message, resolve, reject);
          } catch (error) {
            console.error('[Relay] Failed to parse message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('[Relay] Connection closed:', event.code, event.reason);
          this.cleanup();
          this.updateStatus('disconnected');

          // Attempt reconnection if not intentionally closed
          if (event.code !== 1000 && this.config) {
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('[Relay] WebSocket error:', error);
          this.updateStatus('error', 'Connection failed');
          reject(new Error('Failed to connect to relay server'));
        };

      } catch (error) {
        this.updateStatus('error', (error as Error).message);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the relay server
   */
  disconnect(): void {
    if (this.ws) {
      // Send unregister message before closing
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'unregister' }));
      }
      this.ws.close(1000, 'Intentional disconnect');
    }
    this.cleanup();
    this.config = null;
    this.updateStatus('disconnected');
  }

  /**
   * Get current connection status
   */
  getStatus(): RelayConnection | null {
    if (!this.config) return null;

    return {
      networkId: this.config.networkId,
      tunnelId: this.tunnelId || undefined,
      token: this.token || '',
      relayUrl: this.config.relayUrl || DEFAULT_RELAY_URL,
      publicUrl: this.publicUrl || '',
      status: this.status,
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.status === 'connected';
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(
    message: any,
    resolveConnect?: (connection: RelayConnection) => void,
    rejectConnect?: (error: Error) => void
  ): void {
    switch (message.type) {
      case 'registered':
        this.token = message.token;
        this.tunnelId = message.tunnel_id;
        this.publicUrl = message.relay_url;
        this.updateStatus('connected');
        this.startHeartbeat();
        this.reconnectAttempts = 0;

        console.log('[Relay] Registered successfully:', message.relay_url, 'tunnel:', message.tunnel_id);

        if (resolveConnect) {
          resolveConnect({
            networkId: this.config!.networkId,
            tunnelId: message.tunnel_id,
            token: message.token,
            relayUrl: this.config!.relayUrl || DEFAULT_RELAY_URL,
            publicUrl: message.relay_url,
            status: 'connected',
          });
        }
        break;

      case 'http_request':
        this.handleHttpRequest(message);
        break;

      case 'heartbeat_ack':
        // Heartbeat acknowledged
        break;

      case 'error':
        console.error('[Relay] Error from server:', message.message);
        if (rejectConnect) {
          rejectConnect(new Error(message.message));
        }
        break;

      default:
        console.warn('[Relay] Unknown message type:', message.type);
    }
  }

  /**
   * Handle HTTP requests from the relay (forward to local network)
   */
  private async handleHttpRequest(message: any): Promise<void> {
    const { requestId, method, path, query, headers, body } = message;

    if (!this.config) {
      this.sendHttpResponse(requestId, 503, {}, { error: 'Not configured' });
      return;
    }

    try {
      const protocol = this.config.useHttps ? 'https' : 'http';
      let url = `${protocol}://${this.config.localHost}:${this.config.localPort}${path}`;

      // Add query parameters
      if (query && Object.keys(query).length > 0) {
        const searchParams = new URLSearchParams(query);
        url += `?${searchParams.toString()}`;
      }

      // Filter out headers that shouldn't be forwarded to localhost
      // These can cause CORS issues with the local network
      const headersToSkip = [
        'host',
        'x-forwarded-host',
        'x-forwarded-for',
        'x-forwarded-proto',
        'x-forwarded-port',
        'x-real-ip',
        'cf-connecting-ip',
        'cf-ray',
        'cf-visitor',
        'cf-ipcountry',
        'connection',
        'upgrade',
        'keep-alive',
      ];

      const cleanHeaders: Record<string, string> = {};
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          if (!headersToSkip.includes(key.toLowerCase())) {
            cleanHeaders[key] = value as string;
          }
        }
      }

      // Make request to local network
      const response = await fetch(url, {
        method,
        headers: cleanHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });

      // Get response headers (strip CORS headers to avoid duplicates)
      const responseHeaders: Record<string, string> = {};
      const corsHeadersToSkip = [
        'access-control-allow-origin',
        'access-control-allow-methods',
        'access-control-allow-headers',
        'access-control-allow-credentials',
        'access-control-expose-headers',
        'access-control-max-age',
      ];
      response.headers.forEach((value, key) => {
        if (!corsHeadersToSkip.includes(key.toLowerCase())) {
          responseHeaders[key] = value;
        }
      });

      // Get response body
      let responseBody;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      this.sendHttpResponse(requestId, response.status, responseHeaders, responseBody);

    } catch (error) {
      console.error('[Relay] Failed to forward request:', error);
      this.sendHttpResponse(requestId, 502, {}, {
        error: 'Failed to reach local network',
        details: (error as Error).message,
      });
    }
  }

  /**
   * Send HTTP response back through the relay
   */
  private sendHttpResponse(
    requestId: string,
    status: number,
    headers: Record<string, string>,
    body: any
  ): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'http_response',
        requestId,
        status,
        headers,
        body,
      }));
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, 25000); // Every 25 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[Relay] Max reconnect attempts reached');
      this.updateStatus('error', 'Connection lost');
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY * this.reconnectAttempts;

    console.log(`[Relay] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      if (this.config) {
        this.connect(this.config).catch((error) => {
          console.error('[Relay] Reconnect failed:', error);
        });
      }
    }, delay);
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.ws = null;
    this.token = null;
    this.tunnelId = null;
    this.publicUrl = null;
  }

  /**
   * Update status and notify handlers
   */
  private updateStatus(status: RelayConnection['status'], error?: string): void {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status, error));
  }
}

// Export singleton instance
export const relayClient = new RelayClient();

// Export helper functions
export async function checkRelayStatus(relayUrl: string = DEFAULT_RELAY_URL): Promise<RelayStatus> {
  try {
    // Convert WebSocket URL to HTTP URL for health check
    let httpUrl = relayUrl;
    if (httpUrl.startsWith('ws://')) {
      httpUrl = httpUrl.replace('ws://', 'http://');
    } else if (httpUrl.startsWith('wss://')) {
      httpUrl = httpUrl.replace('wss://', 'https://');
    }

    const response = await fetch(`${httpUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error('Relay server not healthy');
    }

    return await response.json();
  } catch (error) {
    return {
      online: false,
      connectedNetworks: 0,
      uptime: 0,
    };
  }
}

export function getPublicRelayUrl(): string {
  return DEFAULT_RELAY_URL;
}

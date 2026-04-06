/**
 * Connection related type definitions
 */

export enum ConnectionStatusEnum {
  CONNECTED = "connected",
  CONNECTING = "connecting",
  RECONNECTING = "reconnecting",
  DISCONNECTED = "disconnected",
  ERROR = "error",
}

export interface ConnectionStatus {
  status: ConnectionStatusEnum;
  agentId?: string;
  isUsingModifiedId?: boolean;
  latency?: number;
}

export interface NetworkConnection {
  host: string;
  port: number;
  status: ConnectionStatusEnum;
  latency?: number;
  useHttps?: boolean; // HTTPS Feature: Record whether HTTPS is used for the connection
  networkId?: string; // Published network ID for network.openagents.org routing
  networkInfo?: {
    name?: string;
    workspace_path?: string;
  };
}

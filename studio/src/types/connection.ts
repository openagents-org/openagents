/**
 * Connection related type definitions
 */

export enum ConnectionStatusEnum {
  CONNECTED = "connected",
  CONNECTING = "connecting",
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
  networkInfo?: {
    name?: string;
    workspace_path?: string;
  };
}

/**
 * Service Agents API Client
 * Handles all API calls for service agent management using HTTP requests
 */

import { useAuthStore } from "@/stores/authStore";
import { networkFetch } from "@/utils/httpClient";

export interface ServiceAgent {
  agent_id: string;
  status: "running" | "stopped" | "error" | "starting" | "stopping";
  pid?: number | null;
  file_path?: string;
  file_type?: "yaml" | "python";
  start_time?: number | null;
  uptime?: number | null;
  error_message?: string | null;
  [key: string]: any;
}

export interface AgentStatus {
  agent_id: string;
  status: "running" | "stopped" | "error" | "starting" | "stopping";
  pid?: number | null;
  file_path?: string;
  file_type?: "yaml" | "python";
  start_time?: number | null;
  uptime?: number | null;
  error_message?: string | null;
  [key: string]: any;
}

export interface LogEntry {
  timestamp?: string;
  level?: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
  agent_id?: string;
  [key: string]: any;
}

export interface LogsResponse {
  logs: LogEntry[];
  total?: number;
  page?: number;
  page_size?: number;
  has_more?: boolean;
}

/**
 * Get all service agents with their status
 */
export const getServiceAgents = async (): Promise<ServiceAgent[]> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    "/api/agents/service",
    {
      method: "GET",
      useHttps,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch service agents: ${errorText}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Failed to fetch service agents");
  }
  
  return data.agents || [];
};

/**
 * Start a service agent
 */
export const startServiceAgent = async (agentId: string): Promise<void> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/start`,
    {
      method: "POST",
      useHttps,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || data.message || "Failed to start agent");
  }
};

/**
 * Stop a service agent
 */
export const stopServiceAgent = async (agentId: string): Promise<void> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/stop`,
    {
      method: "POST",
      useHttps,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || data.message || "Failed to stop agent");
  }
};

/**
 * Restart a service agent
 */
export const restartServiceAgent = async (agentId: string): Promise<void> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/restart`,
    {
      method: "POST",
      useHttps,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || data.message || "Failed to restart agent");
  }
};

/**
 * Get detailed status of a service agent
 */
export const getAgentStatus = async (agentId: string): Promise<AgentStatus> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/status`,
    {
      method: "GET",
      useHttps,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Failed to fetch agent status");
  }

  return data.status;
};

/**
 * Get recent logs for a service agent
 * Note: Backend returns raw log lines as strings, we parse them into LogEntry format
 */
export const getAgentLogs = async (
  agentId: string,
  lines: number = 100
): Promise<LogsResponse> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const params = new URLSearchParams({
    lines: lines.toString(),
  });

  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/logs/screen?${params.toString()}`,
    {
      method: "GET",
      useHttps,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Failed to fetch agent logs");
  }

  // Backend returns raw log lines as strings, parse them into LogEntry format
  // Format: "2025-12-04 10:00:00 - __main__ - INFO - Echo agent 'test_echo' starting...\n"
  const logLines: string[] = data.logs || [];
  const parsedLogs: LogEntry[] = logLines.map((line) => {
    // Remove trailing newline if present
    const cleanLine = line.trim();
    
    // Try to parse timestamp and level from log line
    // Format: "2025-12-04 10:00:00 - __main__ - INFO - message"
    // Or: "[2025-12-04 10:00:00] [INFO] message"
    const timestampMatch = cleanLine.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    const levelMatch = cleanLine.match(/- (INFO|WARN|ERROR|DEBUG|STDERR|WARNING) -/i) || 
                       cleanLine.match(/\[(INFO|WARN|ERROR|DEBUG|STDERR|WARNING)\]/i);
    
    let message = cleanLine;
    let timestamp: string | undefined;
    let level: "INFO" | "WARN" | "ERROR" | "DEBUG" | undefined;

    if (timestampMatch) {
      timestamp = timestampMatch[1];
    }
    
    if (levelMatch) {
      const levelStr = levelMatch[1].toUpperCase();
      if (levelStr === "STDERR" || levelStr === "ERROR") {
        level = "ERROR";
      } else if (levelStr === "WARNING" || levelStr === "WARN") {
        level = "WARN";
      } else {
        level = levelStr as "INFO" | "WARN" | "ERROR" | "DEBUG";
      }
    }

    // Extract message part (remove timestamp, module name, and level)
    // Format: "2025-12-04 10:00:00 - __main__ - INFO - message"
    if (timestampMatch && levelMatch) {
      // Find the position after the level
      const levelIndex = cleanLine.indexOf(levelMatch[0]);
      if (levelIndex !== -1) {
        message = cleanLine.substring(levelIndex + levelMatch[0].length).trim();
        // Remove leading dash and spaces
        message = message.replace(/^-\s*/, "").trim();
      }
    } else if (timestampMatch) {
      // If we have timestamp but no level match, try to extract message after timestamp
      const timestampIndex = cleanLine.indexOf(timestampMatch[0]);
      if (timestampIndex !== -1) {
        message = cleanLine.substring(timestampIndex + timestampMatch[0].length).trim();
        // Remove leading dash and spaces
        message = message.replace(/^-\s*/, "").trim();
      }
    }

    return {
      timestamp: timestamp || new Date().toISOString(),
      level: level || "INFO",
      message: message || cleanLine,
      agent_id: agentId,
    };
  });

  return {
    logs: parsedLogs,
    total: parsedLogs.length,
  };
};

/**
 * Create WebSocket connection for real-time log streaming
 * Note: Backend doesn't have WebSocket streaming endpoint, so we use polling instead
 * This function is kept for compatibility but will not work until backend implements it
 */
export const createLogStreamWebSocket = (
  agentId: string,
  onMessage: (log: LogEntry) => void,
  onError?: (error: Event) => void,
  onClose?: () => void
): WebSocket | null => {
  // Backend doesn't have WebSocket streaming endpoint yet
  // Return null to indicate WebSocket is not available
  // The component should use polling instead
  console.warn("WebSocket streaming not available, use polling instead");
  if (onError) {
    onError(new Event("not_available"));
  }
  return null;
};

export interface AgentSource {
  content: string;
  file_type: "yaml" | "python";
  file_path: string;
  file_name: string;
}

/**
 * Get the source code of a service agent
 */
export const getAgentSource = async (agentId: string): Promise<AgentSource> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/source`,
    {
      method: "GET",
      useHttps,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Failed to fetch agent source");
  }

  return data.source;
};

export interface SaveSourceResult {
  success: boolean;
  message: string;
  needs_restart?: boolean;
}

/**
 * Save the source code of a service agent
 */
export const saveAgentSource = async (
  agentId: string,
  content: string
): Promise<SaveSourceResult> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/source`,
    {
      method: "PUT",
      useHttps,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || data.message || "Failed to save agent source");
  }

  return data;
};

export interface AgentEnvVars {
  [key: string]: string;
}

export interface SaveEnvVarsResult {
  success: boolean;
  message: string;
  needs_restart?: boolean;
}

/**
 * Get environment variables for a service agent
 */
export const getAgentEnvVars = async (agentId: string): Promise<AgentEnvVars> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/env`,
    {
      method: "GET",
      useHttps,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Failed to fetch agent environment variables");
  }

  return data.env_vars || {};
};

/**
 * Save environment variables for a service agent
 */
export const saveAgentEnvVars = async (
  agentId: string,
  envVars: AgentEnvVars
): Promise<SaveEnvVarsResult> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    `/api/agents/service/${encodeURIComponent(agentId)}/env`,
    {
      method: "PUT",
      useHttps,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ env_vars: envVars }),
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || data.message || "Failed to save environment variables");
  }

  return data;
};

/**
 * Get global environment variables for all service agents
 */
export const getGlobalEnvVars = async (): Promise<AgentEnvVars> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    "/api/agents/service/env/global",
    {
      method: "GET",
      useHttps,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Failed to fetch global environment variables");
  }

  return data.env_vars || {};
};

/**
 * Save global environment variables for all service agents
 */
export const saveGlobalEnvVars = async (
  envVars: AgentEnvVars
): Promise<SaveEnvVarsResult> => {
  const { selectedNetwork } = useAuthStore.getState();
  if (!selectedNetwork) {
    throw new Error("No network selected");
  }

  const { host, port, useHttps } = selectedNetwork;
  const response = await networkFetch(
    host,
    port,
    "/api/agents/service/env/global",
    {
      method: "PUT",
      useHttps,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ env_vars: envVars }),
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || data.message || "Failed to save global environment variables");
  }

  return data;
};


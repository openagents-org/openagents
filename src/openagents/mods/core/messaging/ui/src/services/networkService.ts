import { ConnectionStatusEnum, NetworkConnection } from "../types/connection";
import { networkFetch } from "../utils/httpClient";

export interface NetworkProfile {
  name: string;
  description: string;
  tags: string[];
  categories: string[];
  discoverable: boolean;
  icon?: string;
  website?: string;
  country?: string;
  capacity?: number;
  host?: string;
  port?: number;
  connection?: {
    endpoint?: string;
  };
}

export interface Network {
  id: string;
  profile: NetworkProfile;
  org?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkListResponse {
  page: number;
  perPage: number;
  total: number;
  items: Network[];
}

// Check if a local OpenAgents network is running on localhost:8700 (HTTP port)
export const detectLocalNetwork =
  async (): Promise<NetworkConnection | null> => {
    // Try common HTTP ports for OpenAgents networks
    const commonPorts = [8700, 8571, 8570]; // Try default HTTP port first

    for (const httpPort of commonPorts) {
      try {
        const response = await networkFetch(
          "localhost",
          httpPort,
          "/api/health",
          {
            method: "GET",
            timeout: 3000, // 3 second timeout
          }
        );

        if (response.ok) {
          console.log(
            `Local OpenAgents network detected on HTTP port ${httpPort}`
          );
          return {
            host: "localhost",
            port: httpPort,
            status: ConnectionStatusEnum.CONNECTED,
            latency: 0,
          };
        }
      } catch (error) {
        // Continue to next port
      }
    }

    console.log("No local OpenAgents network detected on common HTTP ports");
    return null;
  };

// Test connection to a specific network using HTTP port directly
export const ManualNetworkConnection = async (
  host: string,
  port: number
): Promise<NetworkConnection> => {
  const startTime = Date.now();

  try {
    console.log(`Testing connection to network: ${host}:${port}`);

    // Use health check endpoint to test connectivity
    const response = await networkFetch(host, port, "/api/health", {
      method: "GET",
      timeout: 5000, // 5 second timeout
      headers: {
        Accept: "application/json",
      },
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      console.log(`Successfully connected to ${host}:${port}`);
      return {
        host,
        port,
        status: ConnectionStatusEnum.CONNECTED,
        latency,
      };
    } else {
      console.error(
        `HTTP error ${response.status} when connecting to ${host}:${port}`
      );
      return {
        host,
        port,
        status: ConnectionStatusEnum.ERROR,
        latency,
      };
    }
  } catch (error) {
    console.error(`Connection test failed for ${host}:${port}:`, error);
    return {
      host,
      port,
      status: ConnectionStatusEnum.ERROR,
      latency: Date.now() - startTime,
    };
  }
};

// Fetch network details by network ID from OpenAgents directory
export const fetchNetworkById = async (
  networkId: string
): Promise<{
  success: boolean;
  network?: any;
  error?: string;
}> => {
  try {
    // Clean network ID - remove protocol prefix if present
    const cleanNetworkId = networkId.replace(/^openagents:\/\//, "");

    const response = await fetch(
      `https://endpoint.openagents.org/v1/networks/${cleanNetworkId}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: false,
          error: `Network '${networkId}' not found`,
        };
      }
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const result = await response.json();

    if (result.code === 200 && result.data) {
      // Check if network is offline
      if (result.data.status === 'offline') {
        const networkName = result.data.profile?.name || networkId;
        return {
          success: false,
          error: `Network '${networkName}' is currently offline`,
          network: result.data,
        };
      }

      return {
        success: true,
        network: result.data,
      };
    } else {
      return {
        success: false,
        error: result.message || "Failed to fetch network information",
      };
    }
  } catch (error: any) {
    console.error(`Error fetching network ${networkId}:`, error);
    return {
      success: false,
      error: error.message || "Network request failed",
    };
  }
};


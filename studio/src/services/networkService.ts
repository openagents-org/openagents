import { ConnectionStatusEnum, NetworkConnection } from "../types/connection";
import { networkFetch } from "../utils/httpClient";
import { HealthResponse } from "../utils/moduleUtils";

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

// Helper function to validate health response data
const isValidHealthResponse = (data: any): boolean => {
  // Check that the response has expected structure
  // A valid health response should have success: true and a data object with network_id
  return (
    data &&
    data.success === true &&
    data.data &&
    typeof data.data.network_id === "string"
  );
};

// Check if a local OpenAgents network is running
// First checks the current origin, then falls back to localhost ports
export const detectLocalNetwork =
  async (): Promise<NetworkConnection | null> => {
    // First, try the current origin (same host/port as the app is served from)
    if (typeof window !== "undefined") {
      try {
        const currentUrl = new URL(window.location.href);
        const currentHost = currentUrl.hostname;
        const currentPort = parseInt(currentUrl.port, 10) || (currentUrl.protocol === "https:" ? 443 : 80);
        const useHttps = currentUrl.protocol === "https:";

        console.log(
          `Checking current origin: ${currentUrl.protocol}//${currentHost}:${currentPort}`
        );

        const response = await networkFetch(
          currentHost,
          currentPort,
          "/api/health",
          {
            method: "GET",
            timeout: 3000,
            useHttps,
            // Disable cache to ensure we get fresh data
            headers: {
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
            },
          }
        );

        if (response.ok) {
          // Validate that we received actual health data, not just a cached/empty response
          try {
            const healthData = await response.json();
            if (isValidHealthResponse(healthData)) {
              console.log(
                `OpenAgents network detected at current origin: ${currentUrl.protocol}//${currentHost}:${currentPort}`
              );
              return {
                host: currentHost,
                port: currentPort,
                status: ConnectionStatusEnum.CONNECTED,
                latency: 0,
                useHttps,
              };
            } else {
              console.log(
                `Invalid health response from current origin: ${currentUrl.protocol}//${currentHost}:${currentPort}`
              );
            }
          } catch (parseError) {
            console.log("Failed to parse health response from current origin");
          }
        }
      } catch (error) {
        console.log("No OpenAgents network at current origin, trying localhost ports...");
      }
    }

    // Fall back to localhost default HTTP port
    const commonPorts = [8700];

    for (const httpPort of commonPorts) {
      try {
        const response = await networkFetch(
          "localhost",
          httpPort,
          "/api/health",
          {
            method: "GET",
            timeout: 3000,
            // Disable cache to ensure we get fresh data
            headers: {
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
            },
          }
        );

        if (response.ok) {
          // Validate that we received actual health data
          try {
            const healthData = await response.json();
            if (isValidHealthResponse(healthData)) {
              console.log(
                `Local OpenAgents network detected on HTTP port ${httpPort}`
              );
              return {
                host: "localhost",
                port: httpPort,
                status: ConnectionStatusEnum.CONNECTED,
                latency: 0,
                useHttps: false,
              };
            } else {
              console.log(
                `Invalid health response from localhost:${httpPort}`
              );
            }
          } catch (parseError) {
            console.log(`Failed to parse health response from localhost:${httpPort}`);
          }
        }
      } catch (error) {
        // Continue to next port
      }
    }

    console.log("No local OpenAgents network detected on common HTTP ports");
    return null;
  };

// Test connection to a specific network using HTTP port directly
// HTTPS Feature: Add useHttps parameter to support HTTPS connections
export const ManualNetworkConnection = async (
  host: string,
  port: number,
  useHttps: boolean = false
): Promise<NetworkConnection> => {
  const startTime = Date.now();

  try {
    // HTTPS Feature: Display connection protocol based on useHttps parameter
    const protocol = useHttps ? 'https' : 'http';
    console.log(`Testing connection to network: ${protocol}://${host}:${port}`);

    // Use health check endpoint to test connectivity
    // HTTPS Feature: Pass useHttps parameter to networkFetch
    const response = await networkFetch(host, port, "/api/health", {
      method: "GET",
      timeout: 5000, // 5 second timeout
      headers: {
        Accept: "application/json",
      },
      useHttps: useHttps, // HTTPS Feature: Pass useHttps parameter to networkFetch
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      console.log(`Successfully connected to ${protocol}://${host}:${port}`);
      return {
        host,
        port,
        status: ConnectionStatusEnum.CONNECTED,
        latency,
        useHttps, // HTTPS Feature: Record whether HTTPS is used for the connection
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

// Mock implementation for fetching networks from OpenAgents directory
export const fetchNetworksList = async (
  params: {
    page?: number;
    perPage?: number;
    tags?: string[];
    categories?: string[];
    org?: string;
    q?: string;
    sort?: string;
  } = {}
): Promise<NetworkListResponse> => {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Mock data - this would be replaced with actual API call
  const mockNetworks: Network[] = [
    {
      id: "research-mesh",
      profile: {
        name: "OpenAgents Centralized Network",
        description:
          "A centralized OpenAgents network for coordinated multi-agent communication",
        icon: "https://openagents.io/icons/centralized-network.png",
        website: "https://openagents.org",
        tags: ["centralized", "production", "coordinated", "reliable"],
        categories: ["enterprise", "research", "collaboration"],
        country: "Worldwide",
        capacity: 500,
        discoverable: true,
      },
      createdAt: "2025-08-10T12:00:00Z",
      updatedAt: "2025-08-10T12:00:00Z",
    },
    {
      id: "edge-lab",
      profile: {
        name: "Edge Lab Experimental Mesh",
        description: "Lightweight edge network for experimental agent testing",
        icon: "https://openagents.io/icons/edge-lab.png",
        website: undefined,
        tags: ["edge", "experimental"],
        categories: ["research", "testing"],
        country: "US",
        capacity: 50,
        discoverable: true,
      },
      org: "organization-name",
      createdAt: "2025-07-15T09:00:00Z",
      updatedAt: "2025-08-10T12:00:00Z",
    },
    {
      id: "community-hub",
      profile: {
        name: "Community Developer Hub",
        description:
          "Open community network for developers to test and share agents",
        tags: ["community", "open-source", "development"],
        categories: ["development", "community"],
        country: "Global",
        capacity: 100,
        discoverable: true,
      },
      createdAt: "2025-08-01T08:00:00Z",
      updatedAt: "2025-08-10T12:00:00Z",
    },
  ];

  // Apply filtering (simplified mock implementation)
  let filteredNetworks = mockNetworks;

  if (params.q) {
    const query = params.q.toLowerCase();
    filteredNetworks = filteredNetworks.filter(
      (network) =>
        network.profile.name.toLowerCase().includes(query) ||
        network.profile.description.toLowerCase().includes(query) ||
        network.profile.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  }

  if (params.tags && params.tags.length > 0) {
    filteredNetworks = filteredNetworks.filter((network) =>
      params.tags!.some((tag) => network.profile.tags.includes(tag))
    );
  }

  if (params.categories && params.categories.length > 0) {
    filteredNetworks = filteredNetworks.filter((network) =>
      params.categories!.some((category) =>
        network.profile.categories.includes(category)
      )
    );
  }

  // Apply pagination
  const page = params.page || 1;
  const perPage = params.perPage || 25;
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const paginatedNetworks = filteredNetworks.slice(start, end);

  return {
    page,
    perPage,
    total: filteredNetworks.length,
    items: paginatedNetworks,
  };
};

/**
 * Fetch network health information including available modules
 * @param connection Network connection information
 * @returns Health response with module information
 */
export const fetchNetworkHealth = async (
  connection: NetworkConnection
): Promise<{
  success: boolean;
  data?: HealthResponse;
  error?: string;
}> => {
  try {
    console.log(`Fetching health information from ${connection.host}:${connection.port}`);

    const response = await networkFetch(
      connection.host,
      connection.port,
      "/api/health",
      {
        method: "GET",
        timeout: 10000, // 10 second timeout
        headers: {
          Accept: "application/json",
        },
        useHttps: connection.useHttps,
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const healthData = await response.json();

    // Validate response structure
    if (!healthData.success || !healthData.data) {
      return {
        success: false,
        error: "Invalid health response format",
      };
    }

    console.log(`Health check successful for ${connection.host}:${connection.port}`, {
      networkId: healthData.data.network_id,
      moduleCount: healthData.data.mods?.length || 0,
    });

    return {
      success: true,
      data: healthData as HealthResponse,
    };
  } catch (error: any) {
    console.error(
      `Failed to fetch health from ${connection.host}:${connection.port}:`,
      error
    );
    return {
      success: false,
      error: error.message || "Network health check failed",
    };
  }
};

/**
 * Get health information for the current network connection
 * Uses the most recently connected network from auth store
 */
export const getCurrentNetworkHealth = async (
  selectedNetwork: NetworkConnection | null
): Promise<{
  success: boolean;
  data?: HealthResponse;
  error?: string;
}> => {
  if (!selectedNetwork) {
    return {
      success: false,
      error: "No network connection available",
    };
  }

  return fetchNetworkHealth(selectedNetwork);
};

/**
 * Upload network icon to the assets folder
 * @param connection Network connection information
 * @param file The image file to upload
 * @returns Upload result with the asset URL
 */
export const uploadNetworkIcon = async (
  connection: NetworkConnection,
  file: File
): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> => {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", "icon");

    const protocol = connection.useHttps ? 'https' : 'http';
    const baseUrl = `${protocol}://${connection.host}:${connection.port}`;

    const response = await fetch(`${baseUrl}/api/assets/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Upload failed: ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.success && data.url) {
      return {
        success: true,
        url: data.url,
      };
    } else {
      return {
        success: false,
        error: data.error || "Upload failed",
      };
    }
  } catch (error: any) {
    console.error("Failed to upload icon:", error);
    return {
      success: false,
      error: error.message || "Upload failed",
    };
  }
};

/**
 * Check if a network is published on OpenAgents directory
 * @param options Lookup options - either networkUuid or host+port
 * @returns Lookup result with network ID if published
 */
export const lookupNetworkPublication = async (
  options: { networkUuid?: string; host?: string; port?: number }
): Promise<{
  published: boolean;
  networkId?: string;
  networkName?: string;
  networkUuid?: string;
  relayUrl?: string;
  error?: string;
}> => {
  try {
    // Build query params - prefer networkUuid over host:port
    let queryParams: string;
    if (options.networkUuid) {
      queryParams = `network_uuid=${encodeURIComponent(options.networkUuid)}`;
    } else if (options.host && options.port) {
      queryParams = `host=${encodeURIComponent(options.host)}&port=${options.port}`;
    } else {
      return { published: false, error: "Either networkUuid or host+port required" };
    }

    const response = await fetch(
      `https://endpoint.openagents.org/v1/networks/lookup?${queryParams}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { published: false };
      }
      return {
        published: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const result = await response.json();

    if (result.code === 200 && result.data) {
      return {
        published: true,
        networkId: result.data.id,
        networkName: result.data.name,
        networkUuid: result.data.network_uuid,
        relayUrl: result.data.relay_url,
      };
    }

    return { published: false };
  } catch (error: any) {
    console.error("Failed to lookup network publication:", error);
    return {
      published: false,
      error: error.message || "Lookup failed",
    };
  }
};

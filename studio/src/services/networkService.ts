export interface NetworkProfile {
  name: string;
  description: string;
  icon?: string;
  website?: string;
  tags: string[];
  categories: string[];
  country?: string;
  capacity?: number;
  discoverable: boolean;
}

export interface Network {
  id: string;
  profile: NetworkProfile;
  org?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkConnection {
  host: string;
  port: number;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  latency?: number;
  networkInfo?: {
    name?: string;
    workspace_path?: string;
  };
}

export interface NetworkListResponse {
  page: number;
  perPage: number;
  total: number;
  items: Network[];
}

// Fetch network info from an OpenAgents network
const fetchNetworkInfo = async (host: string, port: number): Promise<{name?: string, workspace_path?: string} | null> => {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://${host}:${port}`);
      let resolved = false;
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          resolve(null);
        }
      }, 5000);

      ws.onopen = () => {
        // Send a system request to get network info
        const requestId = `network_info_${Date.now()}`;
        ws.send(JSON.stringify({
          type: 'system_request',
          command: 'get_network_info',
          request_id: requestId,
          agent_id: `studio_temp_${Date.now()}`
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'system_response' && data.command === 'get_network_info' && data.success) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              ws.close();
              resolve({
                name: data.network_info?.name,
                workspace_path: data.network_info?.workspace_path
              });
            }
          }
        } catch (err) {
          // Ignore parsing errors
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      };
    } catch (error) {
      resolve(null);
    }
  });
};

// Check if a local OpenAgents network is running on localhost
export const detectLocalNetwork = async (): Promise<NetworkConnection | null> => {
  // Try common ports where OpenAgents might be running
  const portsToTry = [8570, 8571, 8572, 8573, 8574, 8575];
  
  for (const port of portsToTry) {
    try {
      // Try to establish a WebSocket connection to test the OpenAgents network
      const ws = new WebSocket(`ws://localhost:${port}`);
      
      const result = await new Promise<NetworkConnection | null>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(null);
        }, 1000); // Shorter timeout for multiple port attempts

        ws.onopen = async () => {
          clearTimeout(timeout);
          ws.close();
          
          // Fetch additional network info
          const networkInfo = await fetchNetworkInfo('localhost', port);
          
          resolve({
            host: 'localhost',
            port,
            status: 'connected',
            latency: 0,
            networkInfo: networkInfo || undefined
          });
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(null);
        };
      });

      if (result) {
        console.log(`Found local OpenAgents network on port ${port}`);
        return result;
      }
    } catch (error) {
      // Continue to next port
    }
  }
  
  console.log('No local OpenAgents network detected on common ports');
  return null;
};

// Test connection to a specific network
export const testNetworkConnection = async (host: string, port: number): Promise<NetworkConnection> => {
  const startTime = Date.now();
  
  try {
    // Try to establish a WebSocket connection to test the OpenAgents network
    const ws = new WebSocket(`ws://${host}:${port}`);
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve({
          host,
          port,
          status: 'error',
          latency: Date.now() - startTime,
        });
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        const latency = Date.now() - startTime;
        ws.close();
        resolve({
          host,
          port,
          status: 'connected',
          latency,
        });
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({
          host,
          port,
          status: 'error',
          latency: Date.now() - startTime,
        });
      };
    });
  } catch (error) {
    return {
      host,
      port,
      status: 'error',
      latency: Date.now() - startTime,
    };
  }
};

// Mock implementation for fetching networks from OpenAgents directory
export const fetchNetworksList = async (params: {
  page?: number;
  perPage?: number;
  tags?: string[];
  categories?: string[];
  org?: string;
  q?: string;
  sort?: string;
} = {}): Promise<NetworkListResponse> => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Mock data - this would be replaced with actual API call
  const mockNetworks: Network[] = [
    {
      id: "research-mesh",
      profile: {
        name: "OpenAgents Centralized Network",
        description: "A centralized OpenAgents network for coordinated multi-agent communication",
        icon: "https://openagents.io/icons/centralized-network.png",
        website: "https://openagents.org",
        tags: ["centralized", "production", "coordinated", "reliable"],
        categories: ["enterprise", "research", "collaboration"],
        country: "Worldwide",
        capacity: 500,
        discoverable: true
      },
      createdAt: "2025-08-10T12:00:00Z",
      updatedAt: "2025-08-10T12:00:00Z"
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
        discoverable: true
      },
      org: "organization-name",
      createdAt: "2025-07-15T09:00:00Z",
      updatedAt: "2025-08-10T12:00:00Z"
    },
    {
      id: "community-hub",
      profile: {
        name: "Community Developer Hub",
        description: "Open community network for developers to test and share agents",
        tags: ["community", "open-source", "development"],
        categories: ["development", "community"],
        country: "Global",
        capacity: 100,
        discoverable: true
      },
      createdAt: "2025-08-01T08:00:00Z",
      updatedAt: "2025-08-10T12:00:00Z"
    }
  ];

  // Apply filtering (simplified mock implementation)
  let filteredNetworks = mockNetworks;
  
  if (params.q) {
    const query = params.q.toLowerCase();
    filteredNetworks = filteredNetworks.filter(network => 
      network.profile.name.toLowerCase().includes(query) ||
      network.profile.description.toLowerCase().includes(query) ||
      network.profile.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }
  
  if (params.tags && params.tags.length > 0) {
    filteredNetworks = filteredNetworks.filter(network =>
      params.tags!.some(tag => network.profile.tags.includes(tag))
    );
  }
  
  if (params.categories && params.categories.length > 0) {
    filteredNetworks = filteredNetworks.filter(network =>
      params.categories!.some(category => network.profile.categories.includes(category))
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
    items: paginatedNetworks
  };
};

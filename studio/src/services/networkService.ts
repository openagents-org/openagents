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
}

export interface NetworkListResponse {
  page: number;
  perPage: number;
  total: number;
  items: Network[];
}

// Check if a local OpenAgents network is running on localhost:8571
export const detectLocalNetwork = async (): Promise<NetworkConnection | null> => {
  try {
    // Try to establish a WebSocket connection to test the OpenAgents network
    const ws = new WebSocket('ws://localhost:8571');
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        console.log('No local OpenAgents network detected on port 8571');
        resolve(null);
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve({
          host: 'localhost',
          port: 8571,
          status: 'connected',
          latency: 0,
        });
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        console.log('No local OpenAgents network detected on port 8571');
        resolve(null);
      };
    });
  } catch (error) {
    console.log('No local OpenAgents network detected on port 8571');
    return null;
  }
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

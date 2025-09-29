export interface NetworkProfile {
  name: string;
  description: string;
  icon?: string;
  website?: string;
  required_openagents_version?: string;
  mods: any[];
  connection: any;
  discoverable: boolean;
  tags: string[];
  categories: string[];
  country?: string;
  capacity?: number;
  authentication: {
    type: string;
  };
  host: string;
  port: number;
}

export interface NetworkStats {
  online_agents: number;
  views: number;
  likes: number;
}

export interface Network {
  id: string;
  profile: NetworkProfile;
  status: string;
  stats: NetworkStats;
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

export interface ApiNetworkListResponse {
  code: number;
  message: string;
  data: Network[];
}

// Check if a local OpenAgents network is running on localhost:8571
export const detectLocalNetwork = async (): Promise<NetworkConnection | null> => {
  try {
    // Test local gRPC network via HTTP adapter health endpoint (port 9571)
    const response = await fetch('http://localhost:9571/api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(3000) // 3 second timeout
    });

    if (response.ok) {
      console.log('Local OpenAgents network detected on port 8571');
      return {
        host: 'localhost',
        port: 8571,
        status: 'connected',
        latency: 0,
      };
    } else {
      console.log('No local OpenAgents network detected on port 8571');
      return null;
    }
  } catch (error) {
    console.log('No local OpenAgents network detected on port 8571');
    return null;
  }
  
  console.log('No local OpenAgents network detected on common ports');
  return null;
};

// Test connection to a specific network
export const testNetworkConnection = async (host: string, port: number): Promise<NetworkConnection> => {
  const startTime = Date.now();
  
  try {
    // Test gRPC network via HTTP adapter health endpoint (port + 1000)
    const httpPort = port + 1000;
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const testUrl = `${protocol}://${host}:${httpPort}/api/health`;
    
    // Use health check endpoint to test connectivity without creating agents
    const response = await fetch(testUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      return {
        host,
        port,
        status: 'connected',
        latency,
      };
    } else {
      return {
        host,
        port,
        status: 'error',
        latency,
      };
    }
  } catch (error) {
    console.error(`Connection test failed for ${host}:${port}:`, error);
    return {
      host,
      port,
      status: 'error',
      latency: Date.now() - startTime,
    };
  }
};

// Fetch networks from OpenAgents directory API
export const fetchNetworksList = async (params: {
  page?: number;
  perPage?: number;
  tags?: string[];
  categories?: string[];
  org?: string;
  q?: string;
  sort?: string;
} = {}): Promise<NetworkListResponse> => {
  try {
    // Build query parameters
    const queryParams = new URLSearchParams();
    
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.perPage) queryParams.append('per_page', params.perPage.toString());
    if (params.tags && params.tags.length > 0) queryParams.append('tags', params.tags.join(','));
    if (params.categories && params.categories.length > 0) queryParams.append('categories', params.categories.join(','));
    if (params.org) queryParams.append('org', params.org);
    if (params.q) queryParams.append('q', params.q);
    if (params.sort) queryParams.append('sort', params.sort);
    
    const url = `https://endpoint.openagents.org/v1/networks/?${queryParams.toString()}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout for better UX
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch networks: ${response.status} ${response.statusText}`);
    }

    const apiResponse: ApiNetworkListResponse = await response.json();
    
    if (apiResponse.code !== 200) {
      throw new Error(`API error: ${apiResponse.message}`);
    }

    // Transform API response to our expected format
    // Note: The API doesn't seem to return pagination info in the expected format,
    // so we'll calculate it from the data and params
    const page = params.page || 1;
    const perPage = params.perPage || 25;
    
    return {
      page,
      perPage,
      total: apiResponse.data.length, // This might not be the total across all pages
      items: apiResponse.data
    };
  } catch (error) {
    console.error('Error fetching networks from API:', error);
    
    // Fall back to empty list on error, or you could fall back to mock data
    return {
      page: params.page || 1,
      perPage: params.perPage || 25,
      total: 0,
      items: []
    };
  }
};

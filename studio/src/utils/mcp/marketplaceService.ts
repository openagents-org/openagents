import { getAuth } from 'firebase/auth';

/**
 * Interface for marketplace server configuration
 */
export interface MarketplaceServer {
  id: string;
  name: string;
  description: string;
  type: string;
  url: string;
  icon: string;
  models: string[];
  customHeaders: Record<string, string>;
  documentationLink?: string;
}

/**
 * Interface for marketplace data
 */
export interface MarketplaceData {
  servers: MarketplaceServer[];
  updatedAt: number;
}

/**
 * Service for fetching marketplace data
 */
export const marketplaceService = {
  /**
   * Cache for marketplace data
   */
  _cache: null as MarketplaceData | null,

  /**
   * Fetch marketplace data from the backend
   */
  async fetchMarketplaceData(): Promise<MarketplaceData> {
    // Return cached data if available
    if (this._cache) {
      console.log('Using cached marketplace data');
      return this._cache;
    }

    try {
      // Get auth token if possible
      let idToken = null;
      try {
        const auth = getAuth();
        if (auth && auth.currentUser) {
          idToken = await auth.currentUser.getIdToken();
        }
      } catch (authError) {
        console.warn('Authentication not available:', authError);
      }

      // Fetch marketplace data from backend
      const response = await fetch('/api/marketplace', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch marketplace data: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as MarketplaceData;
      this._cache = data;
      return data;
    } catch (error) {
      console.error('Error fetching marketplace data:', error);
      // Return empty data in case of error
      return { servers: [], updatedAt: Date.now() };
    }
  },

  /**
   * Clear the cache to force a refresh on next fetch
   */
  clearCache(): void {
    this._cache = null;
  }
}; 
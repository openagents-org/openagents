/**
 * Publishing API Service
 * 
 * Handles all API calls related to network publishing
 */

import axios from 'axios';

export interface NetworkProfile {
  network_id: string;
  name: string;
  description: string;
  icon?: string;
  website?: string;
  tags: string[];
  categories: string[];
  country: string;
  capacity?: number;
  discoverable: boolean;
  readme?: string;
  host: string;
  port: number;
  required_openagents_version: string;
  authentication?: {
    type: string;
    config?: Record<string, any>;
  };
}

export interface NetworkStats {
  views: number;
  likes: number;
  online_agents: number;
  last_heartbeat?: string;
}

export interface PublishingStatus {
  is_published: boolean;
  network_id?: string;
  status: string;
  last_heartbeat?: string;
  next_heartbeat?: string;
  stats?: NetworkStats;
  discovery_url?: string;
  api_key_configured: boolean;
  auto_heartbeat_enabled: boolean;
}

export interface PublishingSettings {
  api_key?: string;
  auto_heartbeat: boolean;
  heartbeat_interval_minutes: number;
  discovery_server: string;
}

class PublishingApiService {
  private baseUrl = '/api/admin/publishing';

  /**
   * Get current publishing status
   */
  async getStatus(): Promise<PublishingStatus> {
    const response = await axios.get(`${this.baseUrl}/status`);
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'Failed to get publishing status');
  }

  /**
   * Publish network to discovery registry
   */
  async publish(profile?: NetworkProfile): Promise<any> {
    const payload: any = {};
    if (profile) {
      payload.profile = profile;
    }
    const response = await axios.post(`${this.baseUrl}/publish`, payload);
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'Failed to publish network');
  }

  /**
   * Unpublish network from discovery registry
   */
  async unpublish(networkId: string): Promise<boolean> {
    const response = await axios.post(`${this.baseUrl}/unpublish`, {
      network_id: networkId,
    });
    if (response.data.success) {
      return response.data.data.unpublished;
    }
    throw new Error(response.data.error || 'Failed to unpublish network');
  }

  /**
   * Update network profile in registry
   */
  async updateProfile(profile: NetworkProfile): Promise<any> {
    const response = await axios.put(`${this.baseUrl}/profile`, {
      profile,
    });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'Failed to update profile');
  }

  /**
   * Validate network ID availability
   */
  async validateNetworkId(networkId: string): Promise<{ available: boolean; message?: string }> {
    const response = await axios.post(`${this.baseUrl}/validate`, {
      network_id: networkId,
    });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'Failed to validate network ID');
  }

  /**
   * Get network statistics from registry
   */
  async getStats(networkId: string): Promise<NetworkStats> {
    const response = await axios.get(`${this.baseUrl}/stats`, {
      params: { network_id: networkId },
    });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'Failed to get stats');
  }

  /**
   * Manually send heartbeat to registry
   */
  async sendHeartbeat(): Promise<boolean> {
    const response = await axios.post(`${this.baseUrl}/heartbeat`);
    if (response.data.success) {
      return response.data.data.heartbeat_sent;
    }
    throw new Error(response.data.error || 'Failed to send heartbeat');
  }

  /**
   * Update publishing settings
   */
  async updateSettings(settings: PublishingSettings): Promise<void> {
    const response = await axios.put(`${this.baseUrl}/settings`, settings);
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to update settings');
    }
  }
}

export const publishingApi = new PublishingApiService();

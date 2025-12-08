/**
 * Event Explorer API Service
 * Handles all API calls related to the Event Explorer feature
 */

import { buildNetworkUrl } from "@/utils/httpClient";

export interface EventDefinition {
  event_name: string;
  address: string;
  mod_id: string;
  mod_name: string;
  mod_path: string;
  event_type: 'operation' | 'response' | 'notification';
  description: string;
  request_schema?: any;
  response_schema?: any;
  related_events?: string[];
  source_file?: string;
  examples?: {
    python?: string;
    javascript?: string;
  };
}

export interface ModInfo {
  mod_id: string;
  mod_name: string;
  mod_path: string;
  mod_description: string;
  event_count: number;
}

// Get API base URL - will be set dynamically based on network connection
let currentHost = 'localhost';
let currentPort = 8700;

export const setNetworkConnection = (host: string, port: number) => {
  currentHost = host;
  currentPort = port;
};

const getApiUrl = (endpoint: string): string => {
  return buildNetworkUrl(currentHost, currentPort, endpoint);
};

/**
 * Sync events from GitHub repository
 */
export const syncEvents = async (): Promise<{ success: boolean; data?: any; error_message?: string }> => {
  try {
    const response = await fetch(getApiUrl('/api/events/sync'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error_message || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error syncing events:', error);
    return {
      success: false,
      error_message: error.message || 'Failed to sync events',
    };
  }
};

/**
 * Get all events with optional filters
 */
export const getEvents = async (
  modFilter?: string,
  typeFilter?: string
): Promise<{ success: boolean; data?: { events: EventDefinition[]; total: number }; error_message?: string }> => {
  try {
    const params = new URLSearchParams();
    if (modFilter) params.append('mod', modFilter);
    if (typeFilter) params.append('type', typeFilter);

    const url = getApiUrl(`/api/events${params.toString() ? `?${params.toString()}` : ''}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error_message || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error fetching events:', error);
    return {
      success: false,
      error_message: error.message || 'Failed to fetch events',
    };
  }
};

/**
 * Get all mods
 */
export const getMods = async (): Promise<{ success: boolean; data?: { mods: ModInfo[]; total: number }; error_message?: string }> => {
  try {
    const response = await fetch(getApiUrl('/api/events/mods'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error_message || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error fetching mods:', error);
    return {
      success: false,
      error_message: error.message || 'Failed to fetch mods',
    };
  }
};

/**
 * Search events by query
 */
export const searchEvents = async (query: string): Promise<{ success: boolean; data?: { events: EventDefinition[]; total: number; query: string }; error_message?: string }> => {
  try {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(getApiUrl(`/api/events/search?${params.toString()}`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error_message || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error searching events:', error);
    return {
      success: false,
      error_message: error.message || 'Failed to search events',
    };
  }
};

/**
 * Get event detail by name
 */
export const getEventDetail = async (eventName: string): Promise<{ success: boolean; data?: EventDefinition; error_message?: string }> => {
  try {
    const encodedName = encodeURIComponent(eventName);
    const response = await fetch(getApiUrl(`/api/events/${encodedName}`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error_message || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error fetching event detail:', error);
    return {
      success: false,
      error_message: error.message || 'Failed to fetch event detail',
    };
  }
};


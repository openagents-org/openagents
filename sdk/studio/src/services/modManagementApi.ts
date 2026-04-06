/**
 * Module Management API Service
 * 
 * Provides functions to interact with the backend module management API endpoints
 */

import { networkFetch } from '@/utils/httpClient';
import { ModInfo, ConfigSchema, SaveConfigResponse } from '@/types/modConfig';
import { NetworkConnection } from '@/types/connection';

export interface ModManagementApiOptions {
    host: string;
    port: number;
    networkId?: string;
    useHttps?: boolean;
}

/**
 * Get list of all mods with metadata and configuration info
 */
export async function getModsList(options: ModManagementApiOptions): Promise<{ mods: ModInfo[] }> {
    const { host, port, networkId, useHttps } = options;

    const response = await networkFetch(host, port, '/api/admin/mods', {
        method: 'GET',
        networkId,
        useHttps,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch mods list: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data;
}

/**
 * Get current configuration values for a mod
 */
export async function getModConfig(
    options: ModManagementApiOptions,
    modId: string
): Promise<Record<string, any>> {
    const { host, port, networkId, useHttps } = options;

    const response = await networkFetch(host, port, `/api/admin/mods/${encodeURIComponent(modId)}/config`, {
        method: 'GET',
        networkId,
        useHttps,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch mod config: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    // Backend returns { success: true, config: Record<string, any> }
    if (data.success && data.config) {
        return data.config;
    }
    // Fallback: if config is directly in response
    return data;
}

/**
 * Get configuration schema for form generation
 */
export async function getModSchema(
    options: ModManagementApiOptions,
    modId: string
): Promise<ConfigSchema | null> {
    const { host, port, networkId, useHttps } = options;

    const response = await networkFetch(host, port, `/api/admin/mods/${encodeURIComponent(modId)}/schema`, {
        method: 'GET',
        networkId,
        useHttps,
    });

    if (!response.ok) {
        if (response.status === 404) {
            // Mod doesn't have a schema
            return null;
        }
        const errorText = await response.text();
        throw new Error(`Failed to fetch mod schema: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    // Backend returns { success: true, schema: ConfigSchema }
    if (data.success && data.schema) {
        return data.schema;
    }
    // Fallback: if schema is directly in response
    if (data.sections) {
        return data;
    }
    return null;
}

/**
 * Update mod configuration and save to disk
 */
export async function updateModConfig(
    options: ModManagementApiOptions,
    modId: string,
    config: Record<string, any>
): Promise<SaveConfigResponse> {
    const { host, port, networkId, useHttps } = options;

    const response = await networkFetch(host, port, `/api/admin/mods/${encodeURIComponent(modId)}/config`, {
        method: 'PUT',
        networkId,
        useHttps,
        body: JSON.stringify(config),
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorData: any = {};
        try {
            errorData = await response.json();
        } catch {
            // If response is not JSON, use error text
        }

        throw new Error(errorData.message || `Failed to update mod config: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data;
}

/**
 * Restart the network (requires manual restart)
 * Returns a message indicating that manual restart is required
 */
export async function restartNetwork(options: ModManagementApiOptions): Promise<{ message: string; requires_manual_restart: boolean }> {
    const { host, port, networkId, useHttps } = options;

    const response = await networkFetch(host, port, '/api/admin/network/restart', {
        method: 'POST',
        networkId,
        useHttps,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to restart network: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return {
        message: data.message || 'Network restart must be performed manually.',
        requires_manual_restart: data.requires_manual_restart || true,
    };
}


/**
 * Helper function to create API options from NetworkConnection
 */
export function createApiOptions(network: NetworkConnection | null): ModManagementApiOptions | null {
    if (!network || !network.host || !network.port) {
        return null;
    }

    return {
        host: network.host,
        port: network.port,
        networkId: network.networkId,
        useHttps: network.useHttps || false,
    };
}




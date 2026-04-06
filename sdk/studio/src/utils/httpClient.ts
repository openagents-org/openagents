/**
 * HTTP Client utility with automatic network routing support
 *
 * When connecting via a published network ID, routes requests through
 * network.openagents.org/{networkId} which handles both direct connections
 * and relay-based tunneling.
 */

import { eventLogService } from "@/services/eventLogService";
import { networkLogger } from "@/utils/logger";

// Network bridge URL for published networks (handles direct + relay connections)
const NETWORK_BRIDGE_URL = 'https://network.openagents.org';

export interface HttpClientOptions {
  timeout?: number;
  headers?: HeadersInit;
  signal?: AbortSignal | null;
}

/**
 * Check if the current frontend is running on HTTPS
 */
export const isHttps = (): boolean => {
  return window.location.protocol === 'https:';
};

/**
 * Check if a URL is an HTTP URL (not HTTPS)
 */
export const isHttpUrl = (url: string): boolean => {
  return url.startsWith('http://');
};

/**
 * Extract host and port from a URL
 */
export const extractHostPort = (url: string): { host: string; port?: string } => {
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname;
    const port = urlObj.port;
    return { host, port };
  } catch (error) {
    networkLogger.error('Failed to parse URL:', url, error);
    return { host: '', port: undefined };
  }
};

/**
 * Build URL for a published network using network.openagents.org
 */
export const buildNetworkBridgeUrl = (networkId: string, endpoint: string): string => {
  const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  return `${NETWORK_BRIDGE_URL}/${networkId}${path}`;
};

/**
 * Transform URL - currently just passes through directly
 * (Legacy proxy support removed in favor of network ID routing)
 */
export const transformUrlForProxy = (originalUrl: string): { url: string; headers: Record<string, string> } => {
  // Direct connection - no proxy transformation needed
  return {
    url: originalUrl,
    headers: {}
  };
};

/**
 * Enhanced fetch function with timeout support
 */
export const httpFetch = async (
  url: string,
  options: RequestInit & HttpClientOptions = {}
): Promise<Response> => {
  const fetchOptions: RequestInit = {
    ...options,
    headers: new Headers(options.headers),
  };

  // Add timeout if specified
  if (options.timeout && !options.signal) {
    fetchOptions.signal = AbortSignal.timeout(options.timeout);
  }
  
  try {
    networkLogger.debug(`🌐 HTTP Request: ${options.method || 'GET'} ${url}`);

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      networkLogger.error(`❌ HTTP Error ${response.status}: ${response.statusText}`);
    }

    return response;
  } catch (error: unknown) {
    networkLogger.error(`❌ Request failed for ${url}:`, error);
    throw error;
  }
};

/**
 * Build URL for OpenAgents network endpoint with automatic proxy support
 * HTTPS Feature: Support selection of http or https protocol based on useHttps parameter
 */
export const buildNetworkUrl = (host: string, port: number, endpoint: string, useHttps: boolean = false): string => {
  // HTTPS Feature: Select protocol based on useHttps parameter
  const protocol = useHttps ? 'https' : 'http';
  const baseUrl = `${protocol}://${host}:${port}`;
  const fullUrl = `${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  
  const { url } = transformUrlForProxy(fullUrl);
  return url;
};

/**
 * Build headers for OpenAgents network request with automatic proxy support
 * HTTPS Feature: Support selection of http or https protocol based on useHttps parameter
 */
export const buildNetworkHeaders = (host: string, port: number, additionalHeaders: HeadersInit = {}, useHttps: boolean = false): Headers => {
  // HTTPS Feature: Select protocol based on useHttps parameter
  const protocol = useHttps ? 'https' : 'http';
  const baseUrl = `${protocol}://${host}:${port}`;
  const { headers: proxyHeaders } = transformUrlForProxy(baseUrl);
  
  const headers = new Headers(additionalHeaders);
  headers.set('Content-Type', 'application/json');
  
  Object.entries(proxyHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  
  return headers;
};

/**
 * Convenience method for OpenAgents network requests
 * Supports both direct host:port connections and network ID-based routing
 *
 * When networkId is provided, routes through network.openagents.org/{networkId}
 * which handles both direct connections and relay-based tunneling.
 */
export const networkFetch = async (
  host: string,
  port: number,
  endpoint: string,
  options: RequestInit & HttpClientOptions & { useHttps?: boolean; networkId?: string } = {}
): Promise<Response> => {
  // If networkId is provided, use network bridge URL (handles relay networks)
  let url: string;
  if (options.networkId) {
    url = buildNetworkBridgeUrl(options.networkId, endpoint);
  } else {
    // Direct connection to host:port
    const useHttps = options.useHttps || false;
    url = buildNetworkUrl(host, port, endpoint, useHttps);
  }

  // Build headers
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  
  const method = options.method || "GET";
  const startTime = Date.now();
  
  // Parse request body if present
  let requestBody: unknown = undefined;
  if (options.body) {
    try {
      if (typeof options.body === "string") {
        requestBody = JSON.parse(options.body);
      } else {
        requestBody = options.body;
      }
    } catch {
      requestBody = options.body;
    }
  }

  try {
    const response = await httpFetch(url, {
      ...options,
      headers
    });

    const duration = Date.now() - startTime;

    // Parse response body for logging (try to read it without consuming the stream)
    let responseBody: unknown = undefined;
    try {
      const clone = response.clone();
      const contentType = clone.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        responseBody = await clone.json();
      } else {
        const text = await clone.text();
        if (text) {
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text.substring(0, 500); // Limit text length
          }
        }
      }
    } catch {
      // Ignore errors when parsing response body
    }
    
    // Log HTTP request to EventLog
    eventLogService.logHttpRequest({
      method,
      url,
      host,
      port,
      endpoint,
      requestBody,
      responseStatus: response.status,
      responseBody,
      duration,
    });
    
    return response;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    // Log failed HTTP request
    eventLogService.logHttpRequest({
      method,
      url,
      host,
      port,
      endpoint,
      requestBody,
      duration,
      error: error instanceof Error ? error.message : "Request failed",
    });

    throw error;
  }
};
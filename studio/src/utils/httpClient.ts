/**
 * HTTP Client utility with automatic proxy support for HTTPS frontend
 * 
 * When the frontend is running on HTTPS, this utility automatically routes
 * requests to HTTP-only OpenAgents networks through bridge.openagents.org proxy.
 */

import { eventLogService } from "@/services/eventLogService";

const PROXY_BASE_URL = 'https://bridge.openagents.org';

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
    console.error('Failed to parse URL:', url, error);
    return { host: '', port: undefined };
  }
};

/**
 * Transform URL to use proxy when frontend is HTTPS and target is HTTP
 */
export const transformUrlForProxy = (originalUrl: string): { url: string; headers: Record<string, string> } => {
  const frontendIsHttps = isHttps();
  const targetIsHttp = isHttpUrl(originalUrl);
  
  // Only use proxy when frontend is HTTPS and target is HTTP
  if (frontendIsHttps && targetIsHttp) {
    const { host, port } = extractHostPort(originalUrl);
    const targetHost = port ? `${host}:${port}` : host;
    
    // Replace the protocol and host with proxy URL, keep the path
    const urlObj = new URL(originalUrl);
    const proxyUrl = `${PROXY_BASE_URL}${urlObj.pathname}${urlObj.search}`;
    
    return {
      url: proxyUrl,
      headers: {
        'X-Target-Host': targetHost
      }
    };
  }
  
  // Direct connection for HTTP frontend or HTTPS targets
  return {
    url: originalUrl,
    headers: {}
  };
};

/**
 * Enhanced fetch function with automatic proxy support and CORS fallback
 */
export const httpFetch = async (
  url: string, 
  options: RequestInit & HttpClientOptions = {}
): Promise<Response> => {
  const { url: transformedUrl, headers: proxyHeaders } = transformUrlForProxy(url);
  
  // Merge headers - create a Headers object to properly handle different header types
  const mergedHeaders = new Headers(options.headers);
  Object.entries(proxyHeaders).forEach(([key, value]) => {
    mergedHeaders.set(key, value);
  });
  
  const fetchOptions: RequestInit = {
    ...options,
    headers: mergedHeaders
  };
  
  // Add timeout if specified
  if (options.timeout && !options.signal) {
    fetchOptions.signal = AbortSignal.timeout(options.timeout);
  }
  
  try {
    console.log(`🌐 HTTP Request: ${options.method || 'GET'} ${transformedUrl}`);
    if (proxyHeaders['X-Target-Host']) {
      console.log(`🔄 Using proxy for target: ${proxyHeaders['X-Target-Host']}`);
    }
    
    const response = await fetch(transformedUrl, fetchOptions);
    
    if (!response.ok) {
      console.error(`❌ HTTP Error ${response.status}: ${response.statusText}`);
    }
    
    return response;
  } catch (error: any) {
    // Check if this is a CORS error when using proxy
    if (proxyHeaders['X-Target-Host'] && error.message?.includes('CORS')) {
      console.warn(`⚠️ CORS error with proxy, this indicates a server configuration issue:`);
      console.warn(`   - The proxy at ${PROXY_BASE_URL} needs proper CORS headers`);
      console.warn(`   - Target: ${proxyHeaders['X-Target-Host']}`);
      console.warn(`   - Original URL: ${url}`);
    }
    
    console.error(`❌ Request failed for ${transformedUrl}:`, error);
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
 * HTTPS Feature: Support selection of http or https protocol based on options.useHttps parameter
 */
export const networkFetch = async (
  host: string,
  port: number,
  endpoint: string,
  options: RequestInit & HttpClientOptions & { useHttps?: boolean } = {}
): Promise<Response> => {
  // HTTPS Feature: Extract useHttps parameter from options
  const useHttps = options.useHttps || false;
  const url = buildNetworkUrl(host, port, endpoint, useHttps);
  const headers = buildNetworkHeaders(host, port, options.headers, useHttps);
  
  const method = options.method || "GET";
  const startTime = Date.now();
  
  // Parse request body if present
  let requestBody: any = undefined;
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
    let responseBody: any = undefined;
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
  } catch (error: any) {
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
      error: error.message || "Request failed",
    });
    
    throw error;
  }
};
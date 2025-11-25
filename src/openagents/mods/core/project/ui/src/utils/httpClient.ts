const PROXY_BASE_URL = "https://bridge.openagents.org";

export interface HttpClientOptions {
  timeout?: number;
  headers?: HeadersInit;
  signal?: AbortSignal | null;
}

export const isHttps = (): boolean => {
  return window.location.protocol === "https:";
};

export const isHttpUrl = (url: string): boolean => {
  return url.startsWith("http://");
};

export const extractHostPort = (
  url: string
): { host: string; port?: string } => {
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname;
    const port = urlObj.port;
    return { host, port };
  } catch (error) {
    console.error("Failed to parse URL:", url, error);
    return { host: "", port: undefined };
  }
};

export const transformUrlForProxy = (
  originalUrl: string
): { url: string; headers: Record<string, string> } => {
  const frontendIsHttps = isHttps();
  const targetIsHttp = isHttpUrl(originalUrl);

  if (frontendIsHttps && targetIsHttp) {
    const { host, port } = extractHostPort(originalUrl);
    const targetHost = port ? `${host}:${port}` : host;

    const urlObj = new URL(originalUrl);
    const proxyUrl = `${PROXY_BASE_URL}${urlObj.pathname}${urlObj.search}`;

    return {
      url: proxyUrl,
      headers: {
        "X-Target-Host": targetHost,
      },
    };
  }

  return {
    url: originalUrl,
    headers: {},
  };
};

export const httpFetch = async (
  url: string,
  options: RequestInit & HttpClientOptions = {}
): Promise<Response> => {
  const { url: transformedUrl, headers: proxyHeaders } =
    transformUrlForProxy(url);

  const mergedHeaders = new Headers(options.headers);
  Object.entries(proxyHeaders).forEach(([key, value]) => {
    mergedHeaders.set(key, value);
  });

  const fetchOptions: RequestInit = {
    ...options,
    headers: mergedHeaders,
  };

  if (options.timeout && !options.signal) {
    fetchOptions.signal = AbortSignal.timeout(options.timeout);
  }

  try {
    console.log(`🌐 HTTP Request: ${options.method || "GET"} ${transformedUrl}`);
    if (proxyHeaders["X-Target-Host"]) {
      console.log(`🔄 Using proxy for target: ${proxyHeaders["X-Target-Host"]}`);
    }

    const response = await fetch(transformedUrl, fetchOptions);

    if (!response.ok) {
      console.error(`❌ HTTP Error ${response.status}: ${response.statusText}`);
    }

    return response;
  } catch (error: any) {
    if (proxyHeaders["X-Target-Host"] && error.message?.includes("CORS")) {
      console.warn(`⚠️ CORS error with proxy, server configuration issue:`, {
        proxy: PROXY_BASE_URL,
        target: proxyHeaders["X-Target-Host"],
        originalUrl: url,
      });
    }

    console.error(`❌ Request failed for ${transformedUrl}:`, error);
    throw error;
  }
};

export const buildNetworkUrl = (
  host: string,
  port: number,
  endpoint: string
): string => {
  const baseUrl = `http://${host}:${port}`;
  const fullUrl = `${baseUrl}${endpoint.startsWith("/") ? endpoint : "/" + endpoint}`;

  const { url } = transformUrlForProxy(fullUrl);
  return url;
};

export const buildNetworkHeaders = (
  host: string,
  port: number,
  additionalHeaders: HeadersInit = {}
): Headers => {
  const baseUrl = `http://${host}:${port}`;
  const { headers: proxyHeaders } = transformUrlForProxy(baseUrl);

  const headers = new Headers(additionalHeaders);
  headers.set("Content-Type", "application/json");

  Object.entries(proxyHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return headers;
};

export const networkFetch = async (
  host: string,
  port: number,
  endpoint: string,
  options: RequestInit & HttpClientOptions = {}
): Promise<Response> => {
  const url = buildNetworkUrl(host, port, endpoint);
  const headers = buildNetworkHeaders(host, port, options.headers);

  return httpFetch(url, {
    ...options,
    headers,
  });
};


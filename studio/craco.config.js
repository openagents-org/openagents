const path = require("path");

// Read environment variables for proxy configuration
// OPENAGENTS_HTTP_TRANSPORT_PROXY: Set to 'true' to proxy /api/* to localhost
// OPENAGENTS_HTTP_TRANSPORT_PORT: Port number for localhost proxy (default: 8700)
const useHttpTransportProxy = process.env.OPENAGENTS_HTTP_TRANSPORT_PROXY === 'true';
const defaultPort = '8700';
const portFromEnv = process.env.OPENAGENTS_HTTP_TRANSPORT_PORT || defaultPort;

// Validate port number
const validatePort = (port) => {
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    console.warn(`Invalid port number: ${port}. Using default port ${defaultPort}`);
    return defaultPort;
  }
  return portNum.toString();
};

const httpTransportPort = validatePort(portFromEnv);

// Configure proxy based on environment variables
// Note: The default proxy target is a legacy configuration. 
// It's recommended to set OPENAGENTS_DEFAULT_PROXY_TARGET explicitly for your deployment.
const defaultProxyTarget = process.env.OPENAGENTS_DEFAULT_PROXY_TARGET || 'http://localhost:8700';

const proxyTarget = useHttpTransportProxy
  ? `http://localhost:${httpTransportPort}`
  : defaultProxyTarget;

const proxyConfig = {
  '/api': {
    target: proxyTarget,
    changeOrigin: true,
    secure: false,
    timeout: 60000, // 60 second timeout
    proxyTimeout: 60000,
  },
};

module.exports = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  devServer: {
    proxy: proxyConfig,
  },
};

const path = require("path");

// Read environment variables for proxy configuration
// OPENAGENTS_HTTP_TRANSPORT_PROXY: Set to 'true' to proxy /api/* to localhost
// OPENAGENTS_HTTP_TRANSPORT_PORT: Port number for localhost proxy (default: 8700)
const useHttpTransportProxy = process.env.OPENAGENTS_HTTP_TRANSPORT_PROXY === 'true';
const httpTransportPort = process.env.OPENAGENTS_HTTP_TRANSPORT_PORT || '8700';

// Configure proxy based on environment variables
const proxyConfig = useHttpTransportProxy 
  ? {
      '/api': {
        target: `http://localhost:${httpTransportPort}`,
        changeOrigin: true,
        secure: false,
        timeout: 60000, // 60 second timeout
        proxyTimeout: 60000,
      },
    }
  : {
      '/api': {
        target: 'http://cur2.acenta.ai:9572',
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

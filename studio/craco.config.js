const path = require("path");

module.exports = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  devServer: {
    proxy: {
      '/api': {
        target: 'http://cur2.acenta.ai:9572',
        changeOrigin: true,
        secure: false,
        timeout: 60000, // 60秒超时
        proxyTimeout: 60000,
      },
    },
  },
};

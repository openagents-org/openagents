const path = require("path");

module.exports = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "radix-ui": path.resolve(__dirname, "src/lib/radix-ui"),
    },
    configure: (webpackConfig) => {
      // Ignore Monaco Editor source map warnings
      webpackConfig.ignoreWarnings = [
        {
          module: /node_modules\/monaco-editor/,
          message: /Failed to parse source map/,
        },
      ];

      // Disable ForkTsCheckerWebpackPlugin to avoid IPC errors on Node.js v24+
      // TypeScript checking can be done separately via `yarn typecheck`
      webpackConfig.plugins = webpackConfig.plugins.filter(
        (plugin) => plugin.constructor.name !== "ForkTsCheckerWebpackPlugin"
      );

      return webpackConfig;
    },
  },
};

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

      // Disable ForkTsCheckerWebpackPlugin and ESLintWebpackPlugin to speed up dev server
      // TypeScript checking can be done separately via `yarn typecheck`
      // ESLint can be run separately via `yarn lint`
      webpackConfig.plugins = webpackConfig.plugins.filter(
        (plugin) => !["ForkTsCheckerWebpackPlugin", "ESLintWebpackPlugin"].includes(plugin.constructor.name)
      );

      // Code splitting configuration for better performance (production only)
      // In development, react-scripts uses different output filenames that conflict with custom splitChunks
      if (process.env.NODE_ENV === 'production') {
        webpackConfig.optimization = {
          ...webpackConfig.optimization,
          splitChunks: {
            chunks: "all",
            cacheGroups: {
              // Separate Monaco Editor into its own chunk (loaded on demand)
              monaco: {
                test: /[\\/]node_modules[\\/](monaco-editor|@monaco-editor)[\\/]/,
                name: "monaco",
                chunks: "async",
                priority: 30,
              },
              // Separate Yjs collaboration libraries
              yjs: {
                test: /[\\/]node_modules[\\/](yjs|y-monaco|y-websocket|lib0)[\\/]/,
                name: "yjs",
                chunks: "async",
                priority: 25,
              },
              // Separate syntax highlighting libraries
              syntaxHighlight: {
                test: /[\\/]node_modules[\\/](refractor|prismjs|rehype-prism-plus|react-syntax-highlighter)[\\/]/,
                name: "syntax-highlight",
                chunks: "async",
                priority: 20,
              },
              // Vendor chunk for other large libraries
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: "vendors",
                chunks: "all",
                priority: 10,
              },
            },
          },
        };
      }

      return webpackConfig;
    },
  },
};

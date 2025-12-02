const path = require("path");

module.exports = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@wiki": path.resolve(__dirname, "../src/openagents/mods/core/wiki/ui"),
    },
    configure: (webpackConfig, { env, paths }) => {
      // 获取 paths.appSrc（通常是 src 目录）
      const appSrc = paths ? paths.appSrc : path.resolve(__dirname, "src");
      // 移除 ModuleScopePlugin 限制，允许导入 src/ 目录之外的文件
      // ModuleScopePlugin 可能在 plugins 数组中
      if (webpackConfig.plugins) {
        webpackConfig.plugins = webpackConfig.plugins.filter(
          (plugin) => {
            // 检查是否是 ModuleScopePlugin
            const isModuleScopePlugin = 
              plugin.constructor &&
              plugin.constructor.name === "ModuleScopePlugin";
            
            if (isModuleScopePlugin) {
              console.log("Removed ModuleScopePlugin to allow imports outside src/");
            }
            
            return !isModuleScopePlugin;
          }
        );
      }
      
      // 也检查 resolve.plugins（虽然通常不在这里）
      if (webpackConfig.resolve && webpackConfig.resolve.plugins) {
        webpackConfig.resolve.plugins = webpackConfig.resolve.plugins.filter(
          (plugin) => {
            return !(
              plugin.constructor &&
              plugin.constructor.name === "ModuleScopePlugin"
            );
          }
        );
      }
      
      // 确保 resolve 配置存在
      if (!webpackConfig.resolve) {
        webpackConfig.resolve = {};
      }
      
      // 配置模块解析路径
      if (!webpackConfig.resolve.modules) {
        webpackConfig.resolve.modules = [];
      }
      
      // 确保 node_modules 在解析路径中（wiki ui 文件需要访问 studio 的依赖）
      const nodeModulesPath = path.resolve(__dirname, "node_modules");
      if (!webpackConfig.resolve.modules.includes(nodeModulesPath)) {
        webpackConfig.resolve.modules.unshift(nodeModulesPath);
      }
      
      // 将 wiki ui 目录添加到模块解析路径
      const wikiUiPath = path.resolve(__dirname, "../src/openagents/mods/core/wiki/ui");
      if (!webpackConfig.resolve.modules.includes(wikiUiPath)) {
        webpackConfig.resolve.modules.push(wikiUiPath);
      }
      
      // 确保允许解析 wiki ui 目录下的文件
      if (!webpackConfig.resolve.symlinks) {
        webpackConfig.resolve.symlinks = true;
      }
      
      // 确保 wiki ui 目录下的文件也被 babel-loader 处理
      // Create React App 使用 oneOf 规则，需要修改 include 条件
      if (webpackConfig.module && webpackConfig.module.rules) {
        webpackConfig.module.rules.forEach((rule) => {
          if (rule.oneOf && Array.isArray(rule.oneOf)) {
            rule.oneOf.forEach((oneOfRule) => {
              // 找到所有需要处理 TypeScript/JSX 文件的规则
              if (oneOfRule.test) {
                const testStr = oneOfRule.test.toString();
                const isTsx = testStr.includes("tsx") || testStr.includes("\\.tsx");
                const isTs = testStr.includes("ts") || testStr.includes("\\.ts");
                const isJsx = testStr.includes("jsx") || testStr.includes("\\.jsx");
                const isJs = testStr.includes("js") || testStr.includes("\\.js");
                
                if (isTsx || isTs || isJsx || isJs) {
                  // 修改 include 条件，添加 wiki ui 目录
                  if (oneOfRule.include) {
                    if (Array.isArray(oneOfRule.include)) {
                      // 检查是否已经包含 wiki ui 路径
                      const alreadyIncluded = oneOfRule.include.some(
                        (inc) => 
                          (typeof inc === 'string' && inc.includes('wiki/ui')) ||
                          (inc && inc.toString && inc.toString().includes('wiki/ui'))
                      );
                      if (!alreadyIncluded) {
                        oneOfRule.include.push(wikiUiPath);
                      }
                    } else {
                      // 如果是函数，需要特殊处理（Create React App 通常使用函数检查 paths.appSrc）
                      if (typeof oneOfRule.include === 'function') {
                        const originalInclude = oneOfRule.include;
                        oneOfRule.include = (filePath) => {
                          const originalResult = originalInclude(filePath);
                          // 检查是否是 wiki ui 目录下的文件
                          const wikiUiMatch = filePath && (
                            filePath.includes('wiki/ui') || 
                            filePath.includes(wikiUiPath.replace(/\\/g, '/')) ||
                            filePath.includes(wikiUiPath.replace(/\//g, '\\')) ||
                            filePath.startsWith(wikiUiPath.replace(/\\/g, '/')) ||
                            filePath.startsWith(wikiUiPath.replace(/\//g, '\\'))
                          );
                          return originalResult || wikiUiMatch;
                        };
                      } else if (oneOfRule.include === appSrc) {
                        // 如果 include 是 appSrc 路径，扩展为数组
                        oneOfRule.include = [appSrc, wikiUiPath];
                      } else {
                        // 其他情况，转换为数组
                        oneOfRule.include = [oneOfRule.include, wikiUiPath];
                      }
                    }
                  } else {
                    // 如果没有 include，添加 wiki ui 路径
                    oneOfRule.include = wikiUiPath;
                  }
                  
                  // 同时需要确保 exclude 不排除 wiki ui 目录
                  if (oneOfRule.exclude) {
                    if (Array.isArray(oneOfRule.exclude)) {
                      oneOfRule.exclude = oneOfRule.exclude.filter(
                        (exc) => {
                          if (typeof exc === 'string') {
                            return !exc.includes('wiki/ui');
                          }
                          return true;
                        }
                      );
                    } else if (typeof oneOfRule.exclude === 'function') {
                      const originalExclude = oneOfRule.exclude;
                      oneOfRule.exclude = (filePath) => {
                        if (filePath && (
                          filePath.includes('wiki/ui') || 
                          filePath.includes(wikiUiPath.replace(/\\/g, '/')) ||
                          filePath.includes(wikiUiPath.replace(/\//g, '\\'))
                        )) {
                          return false; // 不排除 wiki ui 文件
                        }
                        return originalExclude(filePath);
                      };
                    }
                  }
                }
              }
            });
          }
        });
      }
      
      return webpackConfig;
    },
  },
  devServer: {
    proxy: {
      '/api': {
        target: 'http://cur2.acenta.ai:9572',
        changeOrigin: true,
        secure: false,
        timeout: 60000, // 60 second timeout
        proxyTimeout: 60000,
      },
    },
  },
};

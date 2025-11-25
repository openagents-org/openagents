# 基于插件的模组用户界面架构

## 概述

本文档描述了基于插件的模组用户界面架构，使每个模组都能将用户界面代码与后端代码打包在一起，成为独立的插件。

## 架构特点

1. **共置式结构**: 每个模组的 UI 代码位于 `src/openagents/mods/core/{mod_name}/ui/` 目录
2. **预构建分发**: UI 在打包时预先构建，运行时无需 Node.js
3. **动态发现**: Studio 在运行时自动发现并加载模组 UI
4. **独立开发**: 每个模组可以独立开发和分发

## 目录结构

```
src/openagents/mods/core/
├── wiki/
│   ├── mod.py                    # 后端代码
│   ├── adapter.py
│   ├── mod_manifest.json         # ✨ 包含 UI 元数据
│   └── ui/
│       ├── src/                  # 源文件（开发时使用）
│       │   ├── index.tsx
│       │   └── ...
│       ├── dist/                 # ✨ 预构建文件（打包时包含）
│       │   ├── index.js
│       │   ├── index.css
│       │   └── assets/
│       ├── package.json          # 开发依赖
│       └── vite.config.ts        # 构建配置
```

## mod_manifest.json 格式

每个模组的 `mod_manifest.json` 可以包含 `ui` 配置：

```json
{
  "mod_name": "wiki",
  "version": "1.0.0",
  "ui": {
    "enabled": true,
    "entry": "./ui/dist/index.js",
    "route": "/wiki",
    "sidebar": {
      "label": "Wiki",
      "icon": "BookOpenIcon",
      "position": 2
    },
    "permissions": []
  }
}
```

### UI 配置字段

- `enabled`: 是否启用 UI
- `entry`: 预构建入口文件路径（相对于模组目录）
- `route`: 路由路径
- `sidebar`: 侧边栏配置（可选）
  - `label`: 显示标签
  - `icon`: 图标名称
  - `position`: 位置（数字越小越靠前）
- `permissions`: 所需权限列表

## Python 端实现

### 模组 UI 发现

`src/openagents/utils/mod_ui_loader.py` 提供了模组 UI 发现功能：

- `discover_mod_ui(mod_path)`: 发现单个模组的 UI 配置
- `discover_all_mod_uis()`: 发现所有已安装模组的 UI
- `get_mod_ui_static_path(mod_name)`: 获取模组 UI 静态文件路径

### 健康检查端点

健康检查端点 (`/api/health`) 现在返回 `mod_uis` 字段，包含所有已启用模组的 UI 配置。

### CLI 静态文件服务

CLI 的 HTTP 服务器现在支持 `/mod-ui/{mod_name}/...` 路径，用于提供模组 UI 静态文件。

## Studio 端实现

### 模组 UI 加载器

`studio/src/utils/modUILoader.ts` 提供了动态加载功能：

- `loadModUI(modName, config)`: 动态加载单个模组 UI
- `loadModUIsFromHealth(healthResponse)`: 从健康检查响应加载所有模组 UI
- `getLoadedModUI(modName)`: 获取已加载的模组 UI

### 动态路由

`studio/src/hooks/useDynamicRoutes.ts` 已更新，在加载模块时自动加载模组 UI。

### 模组 UI 包装组件

`studio/src/components/mod/ModUIWrapper.tsx` 提供了用于渲染动态加载模组 UI 的包装组件。

## 开发流程

### 1. 创建模组 UI

在模组目录下创建 `ui/` 目录：

```bash
mkdir -p src/openagents/mods/core/wiki/ui/src
```

### 2. 开发 UI 组件

创建 `ui/src/index.tsx`：

```tsx
import React from 'react';

const WikiModUI: React.FC = () => {
  return <div>Wiki UI Component</div>;
};

export default WikiModUI;
```

### 3. 配置构建

创建 `ui/package.json` 和 `ui/vite.config.ts`（参考 wiki 模组示例）。

### 4. 更新清单

在 `mod_manifest.json` 中添加 `ui` 配置。

### 5. 构建 UI

```bash
cd ui
npm install
npm run build
```

构建后的文件将位于 `ui/dist/` 目录。

### 6. 打包

在 CI/CD 中，所有模组 UI 会在打包前自动构建。`MANIFEST.in` 已更新以包含模组 UI 文件。

## 运行时

1. Studio 启动时，Python 端发现所有模组的 UI 配置
2. 健康检查端点返回模组 UI 元数据
3. Studio 前端动态加载模组 UI 组件
4. 模组 UI 通过 `/mod-ui/{mod_name}/...` 路径提供静态文件

## 优势

1. **独立性**: 每个模组是独立的插件，可以单独开发和分发
2. **无需 Node.js**: 运行时只需 Python，UI 已预构建
3. **动态加载**: Studio 自动发现和加载模组 UI
4. **易于维护**: UI 代码与后端代码共置，便于维护

## 示例

参考 `src/openagents/mods/workspace/wiki/` 目录查看完整的示例实现。


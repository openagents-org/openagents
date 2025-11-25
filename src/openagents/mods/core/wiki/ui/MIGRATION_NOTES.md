# Wiki UI 迁移说明

## 概述

已将 Studio 中的 wiki 前端代码迁移到 `wiki/ui` 目录，实现了基于插件的模组 UI 架构。

## 迁移的文件

### 组件文件
- `studio/src/components/wiki/WikiPageList.tsx` → `wiki/ui/src/components/WikiPageList.tsx`
- `studio/src/components/wiki/WikiPageDetail.tsx` → `wiki/ui/src/components/WikiPageDetail.tsx`
- `studio/src/components/wiki/WikiProposals.tsx` → `wiki/ui/src/components/WikiProposals.tsx`
- `studio/src/components/wiki/components/WikiCreateModal.tsx` → `wiki/ui/src/components/components/WikiCreateModal.tsx`
- `studio/src/components/wiki/components/WikiEditor.tsx` → `wiki/ui/src/components/components/WikiEditor.tsx`

### 页面文件
- `studio/src/pages/wiki/WikiMainPage.tsx` → `wiki/ui/src/pages/WikiMainPage.tsx`
- `studio/src/pages/wiki/WikiSidebar.tsx` → `wiki/ui/src/pages/WikiSidebar.tsx`

### Store 文件
- `studio/src/stores/wikiStore.ts` → `wiki/ui/src/stores/wikiStore.ts`
- `studio/src/stores/recentPagesStore.ts` → `wiki/ui/src/stores/recentPagesStore.ts`
- `studio/src/stores/themeStore.ts` → `wiki/ui/src/stores/themeStore.ts`

### 共享组件和工具
- `studio/src/components/common/MarkdownRenderer.tsx` → `wiki/ui/src/components/common/MarkdownRenderer.tsx`
- `studio/src/components/common/DiffViewer.tsx` → `wiki/ui/src/components/common/DiffViewer.tsx`
- `studio/src/utils/utils.ts` (formatDateTime) → `wiki/ui/src/utils/utils.ts`

## 新增的文件

### 适配器层
- `wiki/ui/src/lib/context.tsx` - 提供访问 Studio OpenAgents 上下文的适配器
- `wiki/ui/src/lib/eventRouter.ts` - 提供访问 Studio 事件路由器的适配器

### 入口文件
- `wiki/ui/src/index.tsx` - Wiki Mod UI 的主入口点

## 主要变更

### 1. 导入路径更新
所有导入路径已从 Studio 的 `@/` 别名更新为相对路径或新的别名。

### 2. 上下文访问
Wiki UI 现在通过 `useWikiMod()` hook 访问 Studio 的 OpenAgents 服务，该 hook 从 `window.__OPENAGENTS_CONTEXT__` 获取上下文。

### 3. 事件处理
Wiki store 现在通过 Studio 的事件路由器（`window.__EVENT_ROUTER__`）处理 wiki 相关事件。

### 4. 路由
Wiki UI 使用自己的 `BrowserRouter`，路由路径相对于 `/wiki` 基础路径。

## Studio 的更新

### 1. OpenAgentsProvider
已更新以将上下文暴露到 `window.__OPENAGENTS_CONTEXT__`，供模组 UI 访问。

### 2. EventRouter
已更新以将事件路由器暴露到 `window.__EVENT_ROUTER__`，供模组 UI 使用。

## 依赖项

Wiki UI 的 `package.json` 已更新，包含以下依赖：

- `react-router-dom` - 路由
- `react-markdown` - Markdown 渲染
- `@uiw/react-md-editor` - Markdown 编辑器
- `diff` - 差异对比
- `zustand` - 状态管理
- `sonner` - 通知（可选）

## 构建配置

`vite.config.ts` 已配置为：
- 构建为 ES 模块库
- 将 React 和相关依赖标记为外部依赖
- 输出到 `dist/index.js`

## 注意事项

1. **侧边栏**: Wiki 侧边栏组件已迁移，但 Studio 的 `SidebarContent` 仍需要更新以支持动态加载模组侧边栏。

2. **路由**: Wiki UI 使用自己的 `BrowserRouter`，这意味着它独立于 Studio 的路由系统。确保 Studio 的路由配置正确加载 Wiki UI。

3. **样式**: Wiki UI 使用 Tailwind CSS 类，确保 Studio 的 Tailwind 配置包含这些样式。

4. **事件系统**: Wiki store 使用 Studio 的事件路由器，确保事件路由器在 Wiki UI 加载前已初始化。

## 下一步

1. 更新 Studio 的 `SidebarContent` 以支持动态加载模组侧边栏
2. 测试 Wiki UI 的完整功能
3. 确保所有依赖项正确安装
4. 构建 Wiki UI 并测试动态加载


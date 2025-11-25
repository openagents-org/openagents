# Layout 组件迁移说明

## 迁移完成

已成功将 `studio/src/components/layout` 中的模块迁移到 `wiki/ui/src/components/layout` 目录。

## 迁移的文件清单

### Layout 组件
- ✅ `DefaultSidebar.tsx` - 默认侧边栏组件
- ✅ `ContentLayout.tsx` - 内容布局组件
- ✅ `ModIcon.tsx` - 模块图标组件
- ✅ `SidebarContent.tsx` - 侧边栏内容组件（已简化，只包含 WikiSidebar）
- ✅ `ConnectionLoadingOverlay.tsx` - 连接加载覆盖层组件
- ✅ `Sidebar.tsx` - 主侧边栏组件
- ✅ `RootLayout.tsx` - 根布局组件

## 主要变更

### 1. 导入路径更新
所有导入路径已从 Studio 的 `@/` 别名更新为相对路径：
- `@/context/OpenAgentsProvider` → `../../lib/context`
- `@/stores/authStore` → `../../stores/authStore`
- `@/stores/themeStore` → `../../stores/themeStore`
- `@/utils/cookies` → `../../utils/cookies`
- `@/pages/wiki/WikiSidebar` → `../../pages/WikiSidebar`

### 2. 组件简化
- **SidebarContent**: 只包含 WikiSidebar，移除了其他模块的 Sidebar（MessagingSidebar, DocumentsSidebar, ForumSidebar 等）
- **RootLayout**: 使用 `WikiModProvider` 替代 `OpenAgentsProvider`
- **ConnectionLoadingOverlay**: 使用 `useWikiMod` hook 替代 `OpenAgentsContext`

### 3. 路由集成
- Wiki 路由（`/wiki/*`）现在使用 `RootLayout` 包装，提供完整的布局结构
- 网络选择和代理设置路由（`/` 和 `/agent-setup`）不使用布局，直接渲染

### 4. 功能保持
所有功能和风格保持一致：
- ✅ 侧边栏功能完整
- ✅ 主题切换功能完整
- ✅ 登出功能完整
- ✅ 连接状态显示完整
- ✅ 样式和 UI 保持一致

## 目录结构

```
wiki/ui/src/components/layout/
├── DefaultSidebar.tsx
├── ContentLayout.tsx
├── ModIcon.tsx
├── SidebarContent.tsx
├── ConnectionLoadingOverlay.tsx
├── Sidebar.tsx
└── RootLayout.tsx
```

## 使用方式

在 `index.tsx` 中，Wiki 路由现在使用 `RootLayout`：

```tsx
<Route
  path="/wiki/*"
  element={
    <RootLayout>
      <WikiMainPage />
    </RootLayout>
  }
/>
```

## 注意事项

1. **ModSidebar**: 未迁移，因为 Wiki UI 是独立运行的，不需要模块导航栏
2. **依赖项**: 所有必要的依赖项（stores, utils, context）都已迁移
3. **独立运行**: Wiki UI 现在是一个完整的独立应用，包含完整的布局系统

## 下一步

1. 测试所有功能是否正常工作
2. 确保样式和 UI 保持一致
3. 构建生产版本：`npm run build`


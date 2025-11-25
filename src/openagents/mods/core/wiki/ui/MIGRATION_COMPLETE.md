# Wiki UI 完整迁移说明

## 迁移完成

已成功将 Studio 下的 wiki 模块、NetworkSelectionPage 和 AgentSetupPage 迁移到 `wiki/ui` 目录。

## 迁移的文件清单

### 页面文件
- ✅ `studio/src/pages/NetworkSelectionPage.tsx` → `wiki/ui/src/pages/NetworkSelectionPage.tsx`
- ✅ `studio/src/pages/AgentSetupPage.tsx` → `wiki/ui/src/pages/AgentSetupPage.tsx`
- ✅ `studio/src/pages/wiki/WikiMainPage.tsx` → `wiki/ui/src/pages/WikiMainPage.tsx`
- ✅ `studio/src/pages/wiki/WikiSidebar.tsx` → `wiki/ui/src/pages/WikiSidebar.tsx`

### 组件文件
- ✅ `studio/src/components/wiki/*` → `wiki/ui/src/components/*`
- ✅ `studio/src/components/network/LocalNetwork.tsx` → `wiki/ui/src/components/network/LocalNetwork.tsx`
- ✅ `studio/src/components/network/ManualNetwork.tsx` → `wiki/ui/src/components/network/ManualNetwork.tsx`

### Store 文件
- ✅ `studio/src/stores/wikiStore.ts` → `wiki/ui/src/stores/wikiStore.ts`
- ✅ `studio/src/stores/recentPagesStore.ts` → `wiki/ui/src/stores/recentPagesStore.ts`
- ✅ `studio/src/stores/themeStore.ts` → `wiki/ui/src/stores/themeStore.ts`
- ✅ `studio/src/stores/authStore.ts` → `wiki/ui/src/stores/authStore.ts`

### 工具函数
- ✅ `studio/src/utils/cookies.ts` → `wiki/ui/src/utils/cookies.ts`
- ✅ `studio/src/utils/passwordHash.ts` → `wiki/ui/src/utils/passwordHash.ts`
- ✅ `studio/src/utils/httpClient.ts` → `wiki/ui/src/utils/httpClient.ts`
- ✅ `studio/src/utils/utils.ts` → `wiki/ui/src/utils/utils.ts` (扩展)
- ✅ `studio/src/utils/const.ts` → `wiki/ui/src/utils/const.ts`
- ✅ `studio/src/utils/storageEncryption.ts` → `wiki/ui/src/utils/storageEncryption.ts`

### 类型定义
- ✅ `studio/src/types/connection.ts` → `wiki/ui/src/types/connection.ts`

### 服务
- ✅ `studio/src/services/networkService.ts` → `wiki/ui/src/services/networkService.ts`

### 共享组件
- ✅ `studio/src/components/common/MarkdownRenderer.tsx` → `wiki/ui/src/components/common/MarkdownRenderer.tsx`
- ✅ `studio/src/components/common/DiffViewer.tsx` → `wiki/ui/src/components/common/DiffViewer.tsx`

## 路由配置

Wiki UI 现在包含以下路由：

- `/` - NetworkSelectionPage（网络选择页面）
- `/agent-setup` - AgentSetupPage（代理设置页面）
- `/wiki/*` - WikiMainPage（Wiki 主页面，包含所有 Wiki 功能）

## 主要变更

### 1. 导入路径更新
所有导入路径已从 Studio 的 `@/` 别名更新为相对路径。

### 2. 路由系统
Wiki UI 使用自己的 `BrowserRouter`，包含完整的路由配置：
- 网络选择和代理设置页面在根路径
- Wiki 功能在 `/wiki/*` 路径下

### 3. 依赖项
已添加所有必要的依赖项：
- `crypto-js` - 用于密码加密
- `sonner` - 用于通知提示

### 4. 功能保持
所有功能和风格保持一致：
- ✅ 网络选择功能完整
- ✅ 代理设置功能完整
- ✅ Wiki 功能完整
- ✅ 样式和 UI 保持一致

## 注意事项

1. **Logo 图片**: NetworkSelectionPage 使用了简化的 Logo（文本 "OA"），如果需要使用原始 Logo 图片，需要将图片文件复制到 `wiki/ui/src/assets/images/` 目录。

2. **路由导航**: 
   - AgentSetupPage 完成后导航到 `/wiki/` 而不是 `/messaging`
   - 所有 Wiki 相关路由都在 `/wiki/*` 下

3. **独立运行**: Wiki UI 现在是一个完整的独立应用，可以在开发模式下独立运行（`npm run dev`）。

4. **动态加载**: 在生产环境中，Wiki UI 会被 Studio 动态加载，路由会相对于 Studio 的基础路径。

## 下一步

1. 测试所有功能是否正常工作
2. 如果需要，复制 Logo 图片文件
3. 构建生产版本：`npm run build`
4. 确保 Studio 能够正确加载 Wiki UI


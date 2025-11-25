# Messaging Mod UI 迁移状态

## 已完成的工作

### 1. 基础配置文件 ✅
- ✅ `package.json` - 项目配置和依赖
- ✅ `vite.config.ts` - 构建配置
- ✅ `tailwind.config.cjs` - Tailwind CSS 配置
- ✅ `postcss.config.cjs` - PostCSS 配置
- ✅ `index.html` - HTML 入口文件
- ✅ `src/index.css` - 全局样式

### 2. 类型定义 ✅
- ✅ `src/types/message.ts` - 消息类型定义和数据适配器
- ✅ `src/types/events.ts` - 事件类型定义
- ✅ `src/types/connection.ts` - 连接状态类型定义

### 3. 工具函数和常量 ✅
- ✅ `src/constants/chatConstants.ts` - 聊天相关常量
- ✅ `src/utils/projectUtils.ts` - 项目工具函数
- ✅ `src/utils/httpClient.ts` - HTTP 客户端工具
- ✅ `src/utils/cookies.ts` - Cookie 工具函数

### 4. 服务文件 ✅
- ✅ `src/services/eventRouter.ts` - 事件路由服务
- ✅ `src/services/notificationService.ts` - 通知服务

## 待完成的工作

### 1. Store 文件
- ⏳ `src/stores/chatStore.ts` - 需要从 `studio/src/stores/chatStore.ts` 迁移
  - 文件很大（2800+ 行），需要更新导入路径（从 `@/` 改为相对路径）
  - 需要更新对 `eventRouter` 和 `notificationService` 的引用

### 2. Context 和 Lib 文件
- ⏳ `src/context/OpenAgentsProvider.tsx` - 需要从 wiki/ui 参考创建
- ⏳ `src/lib/context.tsx` - 需要从 wiki/ui 参考创建
- ⏳ `src/lib/eventRouter.ts` - 需要从 wiki/ui 参考创建
- ⏳ `src/services/eventConnector.ts` - 需要从 `studio/src/services/eventConnector.ts` 迁移

### 3. 组件文件
- ⏳ `src/pages/messaging/components/MessageRenderer.tsx`
- ⏳ `src/pages/messaging/components/MessageInput.tsx`
- ⏳ `src/pages/messaging/components/ProjectChatRoom.tsx`
- ⏳ `src/pages/messaging/components/NotificationPermissionOverlay.tsx`
- ⏳ `src/pages/messaging/components/MarkdownContent.tsx`
- ⏳ `src/pages/messaging/components/AttachmentDisplay.tsx`

### 4. 页面文件
- ⏳ `src/pages/MessagingMainPage.tsx` - 需要从 `studio/src/pages/messaging/MessagingMainPage.tsx` 迁移
- ⏳ `src/pages/MessagingView.tsx` - 需要从 `studio/src/pages/messaging/MessagingView.tsx` 迁移
- ⏳ `src/pages/MessagingSidebar.tsx` - 需要从 `studio/src/pages/messaging/MessagingSidebar.tsx` 迁移

### 5. 入口文件
- ⏳ `src/index.tsx` - 主入口文件（参考 wiki/ui/src/index.tsx）
- ⏳ `src/main.tsx` - 开发模式入口文件（参考 wiki/ui/src/main.tsx）

### 6. 其他依赖文件
- ⏳ 需要检查并迁移所有组件依赖的工具函数和类型
- ⏳ 需要迁移 `messageDisplayUtils.ts` 等工具文件（如果存在）

## 迁移步骤

1. **迁移 Store 文件**
   - 复制 `studio/src/stores/chatStore.ts` 到 `src/stores/chatStore.ts`
   - 更新所有导入路径（`@/` → 相对路径）
   - 更新对 `eventRouter` 和 `notificationService` 的引用

2. **迁移 Context 和 Lib 文件**
   - 参考 `wiki/ui/src/context/OpenAgentsProvider.tsx` 创建 messaging 版本
   - 参考 `wiki/ui/src/lib/context.tsx` 创建 messaging 版本
   - 迁移 `eventConnector.ts` 并更新导入路径

3. **迁移组件文件**
   - 逐个迁移组件文件
   - 更新所有导入路径
   - 确保组件之间的依赖关系正确

4. **迁移页面文件**
   - 迁移 `MessagingMainPage.tsx`
   - 迁移 `MessagingView.tsx`
   - 迁移 `MessagingSidebar.tsx`
   - 更新所有导入路径

5. **创建入口文件**
   - 创建 `src/index.tsx`（参考 wiki/ui）
   - 创建 `src/main.tsx`（参考 wiki/ui）
   - 配置路由

6. **测试和修复**
   - 运行 `npm install`
   - 运行 `npm run dev` 测试开发模式
   - 修复所有导入错误和类型错误
   - 运行 `npm run build` 测试生产构建

## 注意事项

1. **导入路径更新**：所有 `@/` 别名需要改为相对路径
2. **依赖检查**：确保所有依赖的 store、utils、services 都已迁移
3. **类型检查**：确保所有类型定义都已迁移
4. **路由配置**：messaging UI 应该使用 `/messaging/*` 路由
5. **独立运行**：messaging UI 应该可以独立运行（开发模式）

## 参考文件

- Wiki UI 迁移完成文档：`src/openagents/mods/workspace/wiki/ui/MIGRATION_COMPLETE.md`
- Wiki UI 构建文档：`src/openagents/mods/workspace/wiki/ui/BUILD.md`
- Wiki UI 入口文件：`src/openagents/mods/workspace/wiki/ui/src/index.tsx`


# OpenAgentsProvider 迁移说明

## 迁移完成

已成功将 `studio/src/context/OpenAgentsProvider.tsx` 迁移到 `wiki/ui/src/context/OpenAgentsProvider.tsx`，并更新了所有相关组件。

## 迁移的文件清单

### 核心文件
- ✅ `OpenAgentsProvider.tsx` - 简化版的 OpenAgents Provider（只包含 Wiki UI 需要的功能）
- ✅ `eventConnector.ts` - HTTP Event Connector 类
- ✅ `eventRouter.ts` - 事件路由器
- ✅ `events.ts` - 事件类型定义

### 更新的组件
- ✅ `RootLayout.tsx` - 使用 `OpenAgentsProvider` 替代 `WikiModProvider`
- ✅ `ConnectionLoadingOverlay.tsx` - 使用 `useOpenAgents` hook
- ✅ `WikiPageList.tsx` - 使用 `useOpenAgents` hook
- ✅ `WikiSidebar.tsx` - 使用 `useOpenAgents` hook
- ✅ `WikiProposals.tsx` - 使用 `useOpenAgents` hook
- ✅ `WikiPageDetail.tsx` - 使用 `useOpenAgents` hook

## 主要变更

### 1. 简化版的 OpenAgentsProvider
移除了 Wiki UI 不需要的功能：
- ❌ Chat store 相关功能
- ❌ Document store 相关功能
- ❌ Notification service（Wiki UI 不需要）
- ❌ 全局通知监听器（Wiki UI 不需要）

保留了 Wiki UI 需要的功能：
- ✅ 连接管理
- ✅ 连接状态管理
- ✅ 事件路由初始化
- ✅ Wiki 事件监听支持

### 2. Service 适配器模式
所有组件现在使用 `useOpenAgents` hook 获取 `connector`，然后创建 service 适配器：

```typescript
const { connector, isConnected } = useOpenAgents();

const service = React.useMemo(() => {
  if (!connector) return null;
  
  return {
    sendEvent: async (event) => {
      return await connector.sendEvent({
        event_name: event.event_name,
        destination_id: event.destination_id,
        payload: event.payload,
      });
    },
    getAgentId: () => {
      return connector.getAgentId() || null;
    },
  };
}, [connector]);
```

### 3. isConnected 修复
- `isConnected` 现在始终是布尔值（`true` 或 `false`），不会是 `null`
- 使用 `connectionStatus.state === ConnectionState.CONNECTED` 计算
- 在 `RootLayout` 和 `ConnectionLoadingOverlay` 中使用严格的布尔比较

### 4. 导入路径更新
所有导入路径已更新：
- `@/context/OpenAgentsProvider` → `../context/OpenAgentsProvider`
- `@/services/eventConnector` → `../services/eventConnector`
- `@/types/events` → `../types/events`

## 目录结构

```
wiki/ui/src/
├── context/
│   └── OpenAgentsProvider.tsx  # 简化版的 OpenAgents Provider
├── services/
│   ├── eventConnector.ts       # HTTP Event Connector
│   └── eventRouter.ts          # 事件路由器
└── types/
    └── events.ts                # 事件类型定义
```

## 功能保持

所有功能保持一致：
- ✅ 连接管理功能完整
- ✅ 连接状态显示完整
- ✅ 事件发送和接收功能完整
- ✅ Wiki 事件监听功能完整
- ✅ 自动重连功能完整

## 注意事项

1. **独立运行**: Wiki UI 现在是一个完整的独立应用，包含自己的连接管理
2. **事件路由**: `eventRouter` 已迁移，支持 Wiki 事件路由
3. **窗口暴露**: `OpenAgentsProvider` 会将 context 暴露到 `window.__OPENAGENTS_CONTEXT__`，以便其他模块访问

## 下一步

1. 测试所有功能是否正常工作
2. 确保连接状态正确显示
3. 确保 Wiki 事件能够正常发送和接收
4. 构建生产版本：`npm run build`


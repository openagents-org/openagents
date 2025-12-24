# 产品需求文档：管理员界面细节改进

**版本:** 1.0
**日期:** 2024年12月24日
**作者:** OpenAgents Team
**状态:** 草稿

---

## 1. 概述

### 1.1 背景

OpenAgents Studio 的管理员界面目前存在多个未完成的功能和细节问题。这些问题影响了管理员的日常操作效率和系统监控能力。本PRD旨在梳理并完善这些管理员界面的细节功能。

### 1.2 目标

- 完善 Transport 配置管理功能
- 实现网络重启功能
- 修复仪表盘指标显示
- 启用设置页面和MCP管理页面
- 提升管理员操作体验

### 1.3 范围

本PRD覆盖以下模块：
- Admin Dashboard（管理员仪表盘）
- Transport Config（传输层配置）
- Settings Page（设置页面）
- MCP Management（MCP管理）
- Service Agents（服务代理管理）

---

## 2. 功能需求

### 2.1 Transport 配置管理

**当前状态:** UI存在但所有操作显示"not implemented yet"

**需要实现的功能:**

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **启用/禁用 Transport** | 管理员可以启用或禁用特定的传输层（HTTP, gRPC, WebSocket, MCP） | P0 |
| **保存 Transport 配置** | 修改传输层配置后保存到 network.yaml | P0 |
| **添加新 Transport** | 添加新的传输层实例 | P1 |
| **删除 Transport** | 删除不需要的传输层配置 | P1 |
| **配置验证** | 保存前验证配置的有效性 | P1 |

**技术实现:**

```
前端 (TransportConfig.tsx)
    │
    ▼
API 调用
    │
    ▼
后端 API Endpoints:
    - PUT /api/admin/transports/{transport_id}/enable
    - PUT /api/admin/transports/{transport_id}/disable
    - PUT /api/admin/transports/{transport_id}/config
    - POST /api/admin/transports
    - DELETE /api/admin/transports/{transport_id}
    │
    ▼
更新 network.yaml 配置文件
    │
    ▼
热重载 Transport（无需重启网络）
```

**验收标准:**
- [ ] 点击启用/禁用按钮后，Transport 状态正确更新
- [ ] 修改配置后点击保存，配置持久化到 network.yaml
- [ ] 添加新 Transport 后，列表正确显示
- [ ] 删除 Transport 后，配置被移除
- [ ] 配置错误时显示验证错误信息

---

### 2.2 网络重启功能

**当前状态:** 代码存在但被注释，显示 TODO

**需要实现的功能:**

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **软重启** | 重新加载配置，不中断现有连接 | P0 |
| **硬重启** | 完全重启网络，断开所有连接 | P1 |
| **重启确认** | 显示确认对话框，防止误操作 | P0 |
| **重启状态** | 显示重启进度和状态 | P1 |

**UI 设计:**

```
┌─────────────────────────────────────────┐
│  ⚠️ 确认重启网络                         │
├─────────────────────────────────────────┤
│                                         │
│  重启类型:                               │
│  ○ 软重启 (重新加载配置)                  │
│  ○ 硬重启 (完全重启，断开所有连接)         │
│                                         │
│  当前连接的 Agent 数量: 5                 │
│                                         │
│  ⚠️ 硬重启将断开所有 Agent 连接            │
│                                         │
│         [取消]        [确认重启]          │
└─────────────────────────────────────────┘
```

**API 设计:**

```
POST /api/admin/network/restart
{
    "type": "soft" | "hard",
    "reason": "配置更新"  // 可选，记录重启原因
}

Response:
{
    "status": "restarting",
    "estimated_time": 5,  // 秒
    "message": "网络正在重启..."
}
```

---

### 2.3 仪表盘指标修复

**当前状态:** Events Per Minute 硬编码为 0

**需要实现的功能:**

| 指标 | 描述 | 优先级 |
|------|------|--------|
| **Events Per Minute** | 每分钟事件数量统计 | P0 |
| **Active Agents** | 当前活跃 Agent 数量 | P0 |
| **Message Throughput** | 消息吞吐量 | P1 |
| **Error Rate** | 错误率统计 | P1 |
| **LLM Token Usage** | LLM Token 使用统计 | P2 |

**数据来源:**

```
Event Log Store
    │
    ├── 最近1分钟事件计数 → Events Per Minute
    ├── Agent 心跳记录 → Active Agents
    ├── 消息事件统计 → Message Throughput
    ├── 错误事件统计 → Error Rate
    └── LLM Log Store → Token Usage
```

**实现方案:**

```typescript
// 在 AdminDashboard.tsx 中
const calculateEventsPerMinute = () => {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentEvents = eventLogs.filter(
        e => e.timestamp > oneMinuteAgo
    );
    return recentEvents.length;
};

// 使用 useInterval 每10秒更新一次
useInterval(() => {
    setEventsPerMinute(calculateEventsPerMinute());
}, 10000);
```

---

### 2.4 设置页面启用

**当前状态:** 路由和导航图标被注释

**需要恢复的功能:**

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **网络设置** | 网络名称、描述、README 编辑 | P0 |
| **Agent 默认配置** | 默认 LLM、温度、最大Token | P1 |
| **Mod 设置** | 各 Mod 的配置选项 | P1 |
| **外观设置** | 主题、语言、时区 | P2 |
| **通知设置** | 通知偏好配置 | P2 |

**恢复步骤:**

1. 取消注释 `routeConfig.ts` 中的 Settings 导入和路由
2. 取消注释 NavigationIcons 中的设置图标
3. 确保 SettingsMainPage 组件完整可用
4. 测试所有设置功能

---

### 2.5 MCP 管理页面启用

**当前状态:** 路由和导航图标被注释

**需要恢复的功能:**

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **MCP 状态** | 显示 MCP Transport 状态 | P0 |
| **工具列表** | 显示暴露的 MCP Tools | P0 |
| **连接信息** | 显示 MCP 连接 URL 和配置 | P0 |
| **工具测试** | 测试调用 MCP Tools | P1 |
| **访问日志** | MCP 访问记录 | P2 |

**MCP 管理界面设计:**

```
┌─────────────────────────────────────────────────────────┐
│  MCP Server 管理                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  状态: ● 运行中                    端口: 8800           │
│                                                         │
│  连接 URL:                                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ http://localhost:8800/mcp                  [复制] │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  暴露的工具 (12)                              [刷新]    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 🔧 send_message          发送消息到频道          │   │
│  │ 🔧 list_agents           列出所有 Agent         │   │
│  │ 🔧 get_wiki_page         获取 Wiki 页面         │   │
│  │ 🔧 create_document       创建共享文档            │   │
│  │ ...                                              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Claude Code 配置示例:                                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ {                                                │   │
│  │   "mcpServers": {                               │   │
│  │     "openagents": {                             │   │
│  │       "url": "http://localhost:8800/mcp"        │   │
│  │     }                                           │   │
│  │   }                                             │   │
│  │ }                                          [复制] │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### 2.6 消息未读计数

**当前状态:** 硬编码为空对象

**需要实现的功能:**

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **频道未读计数** | 每个频道的未读消息数量 | P0 |
| **私信未读计数** | 每个私信会话的未读数量 | P0 |
| **总未读徽章** | 导航栏显示总未读数 | P1 |
| **已读标记** | 进入频道/会话时标记已读 | P0 |

**实现方案:**

```typescript
// MessagingStore 中添加
interface UnreadState {
    channels: Record<string, number>;  // channel_id -> count
    directMessages: Record<string, number>;  // agent_id -> count
    lastRead: Record<string, number>;  // thread_id -> timestamp
}

// 计算未读数
const getUnreadCount = (threadId: string) => {
    const lastRead = unreadState.lastRead[threadId] || 0;
    const messages = getMessagesForThread(threadId);
    return messages.filter(m => m.timestamp > lastRead).length;
};

// 标记已读
const markAsRead = (threadId: string) => {
    unreadState.lastRead[threadId] = Date.now();
    // 持久化到 localStorage
    saveUnreadState();
};
```

---

### 2.7 私信附件支持

**当前状态:** 仅频道消息支持附件

**需要实现的功能:**

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **私信附件上传** | 在私信中上传文件 | P1 |
| **附件预览** | 图片/文档预览 | P1 |
| **附件下载** | 下载附件到本地 | P1 |

---

## 3. 技术方案

### 3.1 API 端点汇总

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/admin/transports` | GET | 获取所有 Transport 配置 |
| `/api/admin/transports` | POST | 添加新 Transport |
| `/api/admin/transports/{id}` | PUT | 更新 Transport 配置 |
| `/api/admin/transports/{id}` | DELETE | 删除 Transport |
| `/api/admin/transports/{id}/enable` | PUT | 启用 Transport |
| `/api/admin/transports/{id}/disable` | PUT | 禁用 Transport |
| `/api/admin/network/restart` | POST | 重启网络 |
| `/api/admin/metrics` | GET | 获取仪表盘指标 |
| `/api/mcp/status` | GET | 获取 MCP 状态 |
| `/api/mcp/tools` | GET | 获取 MCP 工具列表 |

### 3.2 前端文件修改

| 文件 | 修改内容 |
|------|----------|
| `routeConfig.ts` | 取消注释 Settings 和 MCP 路由 |
| `TransportConfig.tsx` | 实现所有 API 调用 |
| `AdminDashboard.tsx` | 实现指标计算和网络重启 |
| `MessagingSidebar.tsx` | 实现未读计数逻辑 |
| `MessagingView.tsx` | 添加私信附件支持 |
| `SettingsMainPage.tsx` | 确保页面功能完整 |
| `McpMainPage.tsx` | 确保页面功能完整 |

---

## 4. 优先级排序

### P0 - 必须完成（第一阶段）

1. Transport 启用/禁用/保存
2. 仪表盘指标修复（Events Per Minute）
3. 设置页面启用
4. MCP 管理页面启用
5. 消息未读计数

### P1 - 重要功能（第二阶段）

1. Transport 添加/删除
2. 网络重启功能
3. 私信附件支持
4. MCP 工具测试

### P2 - 增强功能（第三阶段）

1. 更多仪表盘指标
2. 外观和通知设置
3. MCP 访问日志

---

## 5. 测试计划

### 5.1 功能测试

| 测试项 | 测试步骤 | 预期结果 |
|--------|----------|----------|
| Transport 启用 | 点击启用按钮 | Transport 状态变为启用，服务正常 |
| Transport 禁用 | 点击禁用按钮 | Transport 状态变为禁用，端口关闭 |
| 配置保存 | 修改端口后保存 | network.yaml 更新，Transport 使用新端口 |
| 网络重启 | 点击重启按钮 | 网络重启成功，Agent 重新连接 |
| 指标显示 | 发送多条消息 | Events Per Minute 正确统计 |
| 未读计数 | 收到新消息 | 未读徽章显示正确数字 |

### 5.2 边界测试

- 无 Transport 时的界面显示
- 配置无效时的错误处理
- 网络重启期间的用户操作
- 大量未读消息时的性能

---

## 6. 时间估算

| 功能 | 开发时间 | 测试时间 |
|------|----------|----------|
| Transport 配置管理 | 3天 | 1天 |
| 网络重启功能 | 2天 | 1天 |
| 仪表盘指标修复 | 1天 | 0.5天 |
| 设置页面启用 | 1天 | 0.5天 |
| MCP 管理页面 | 2天 | 1天 |
| 消息未读计数 | 2天 | 1天 |
| 私信附件支持 | 2天 | 1天 |
| **总计** | **13天** | **6天** |

---

## 7. 附录

### 7.1 相关代码位置

```
studio/src/
├── pages/
│   ├── admin/
│   │   ├── AdminDashboard.tsx      # 仪表盘
│   │   └── TransportConfig.tsx     # Transport 配置
│   ├── settings/
│   │   └── SettingsMainPage.tsx    # 设置页面
│   ├── mcp/
│   │   └── McpMainPage.tsx         # MCP 管理
│   └── messaging/
│       ├── MessagingSidebar.tsx    # 未读计数
│       └── MessagingView.tsx       # 附件支持
├── config/
│   └── routeConfig.ts              # 路由配置
└── stores/
    └── messagingStore.ts           # 消息状态
```

### 7.2 参考文档

- OpenAgents API 文档
- MCP 协议规范
- React 最佳实践

---

*文档维护: OpenAgents Team*

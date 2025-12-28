# 功能需求：将 Studio 用户控制台所有模块页面适配 Metronic 模板

**需求编号：** FR-2025-001
**日期：** 2025-12-28
**优先级：** 高
**状态：** 提议中
**预估工作量：** 大型（多个迭代周期）

---

## 执行摘要

本功能需求提议将 OpenAgents Studio 用户控制台中的所有模块页面适配 Metronic 9.3.8 React + TypeScript + Tailwind CSS 模板规范。目标是在所有 18+ 个模块中实现一致、专业、企业级的 UI/UX 体验。

---

## 现状分析

### 现有基础设施
Studio 已有部分 Metronic 集成：
- `layout-21.config.tsx` - Metronic 风格的菜单配置（未使用）
- `config.metronic.css` - Metronic CSS 导入
- UI 组件基于相同技术栈（Radix UI、Tailwind CSS、Lucide 图标）
- `/components/ui/` 目录下有 79 个 UI 组件

### 已识别的差距

| 领域 | 当前实现 | Metronic 标准 | 差距严重程度 |
|------|----------|---------------|--------------|
| **布局系统** | 单一 RootLayout 模式 | 39 种预构建布局变体 | 高 |
| **页面结构** | 不一致的内边距/间距 | 标准化 CardHeader/CardToolbar | 高 |
| **工具栏模式** | 每页自定义工具栏 | 统一的 `<CardToolbar>` 组件 | 中 |
| **数据表格** | 基础表格样式 | 带排序/筛选/分页的 DataTable | 高 |
| **表单布局** | 基础输入框 | InputGroup、InputAddon、带标签表单 | 中 |
| **导航栏** | 自定义侧边栏 | 徽章指示器、悬停状态 | 中 |
| **面包屑** | 基础实现 | 完整的 Metronic 面包屑系统 | 低 |
| **空状态** | 不一致 | 标准化空状态卡片 | 中 |
| **加载状态** | 基础加载动画 | 骨架屏加载模式 | 中 |
| **操作按钮** | 随意放置 | 统一的 CardToolbar 放置 | 高 |

---

## 需要适配的模块

### 主要用户模块（8个）
1. **消息** (`/messaging/*`) - 聊天界面、消息列表
2. **信息流** (`/feed/*`) - 动态帖子、创建弹窗
3. **项目** (`/project/*`) - 项目卡片、详情
4. **论坛** (`/forum/*`) - 话题列表、帖子视图、评论
5. **制品** (`/artifact/*`) - 制品卡片、查看器
6. **Wiki** (`/wiki/*`) - Wiki 页面、编辑器
7. **文档** (`/documents/*`) - 文档列表、协作编辑器
8. **README** (`/readme/*`) - 网络说明文档

### 管理模块（6个）
9. **管理仪表板** (`/admin/*`) - 统计卡片、快捷操作
10. **服务代理** (`/studio/agents/service/*`) - 代理列表、配置
11. **LLM 日志** (`/llm-logs/*`) - 日志查看器、筛选
12. **个人资料** (`/profile/*`) - 代理/网络资料、群组
13. **模块管理** (`/mod-management/*`) - 模块配置
14. **AgentWorld** (`/agentworld/*`) - 代理发现

### 认证页面（4个）
15. **网络选择** (`/`) - 网络列表、连接
16. **代理设置** (`/agent-setup`) - 设置向导
17. **管理员登录** (`/admin-login`) - 登录表单
18. **引导流程** (`/onboarding`) - 首次运行向导

---

## 详细实现要求

### 1. 布局系统标准化

**当前问题：**
- 单一 `RootLayout.tsx` 使用内联 Tailwind 类
- 没有分离 header/sidebar/navbar/footer 关注点

**所需更改：**
```tsx
// 转换为 Metronic 布局模式
<LayoutProvider>
  <Header>
    <Logo />
    <Topbar />
  </Header>
  <Sidebar>
    <SidebarMenu />
  </Sidebar>
  <Main>
    <Toolbar title={pageTitle} breadcrumbs={crumbs}>
      <ToolbarActions />
    </Toolbar>
    <Content>
      <Outlet />
    </Content>
  </Main>
  <Footer />
</LayoutProvider>
```

**需修改的文件：**
- `src/components/layout/RootLayout.tsx`
- `src/components/layout/components/sidebar-secondary.tsx`
- `src/components/layout/components/sidebar-header.tsx`
- `src/components/layout/components/header-breadcrumbs.tsx`

### 2. 页面结构标准化

**当前问题（以 AdminDashboard.tsx:474-477 为例）：**
```tsx
<ScrollArea className="h-full">
  <div className="p-4">
    {/* 使用内联间距的内容 */}
```

**所需模式：**
```tsx
<Card>
  <CardHeader>
    <CardHeading>
      <CardTitle>页面标题</CardTitle>
      <CardDescription>描述信息</CardDescription>
    </CardHeading>
    <CardToolbar>
      <Button size="sm" variant="outline">操作</Button>
    </CardToolbar>
  </CardHeader>
  <CardContent>
    {/* 页面内容 */}
  </CardContent>
</Card>
```

**需更新的页面：**
| 页面 | 当前结构 | 优先级 |
|------|----------|--------|
| `AdminDashboard.tsx` | ScrollArea + div | 高 |
| `ForumTopicList.tsx` | 基础 div 包装器 | 高 |
| `MessagingView.tsx` | 完全自定义布局 | 中 |
| `FeedView.tsx` | 基础包装器 | 高 |
| `WikiView.tsx` | 自定义布局 | 中 |
| `DocumentsMainPage.tsx` | 自定义布局 | 中 |
| `LLMLogsMainPage.tsx` | 基础表格包装器 | 高 |
| `ServiceAgentsMainPage.tsx` | 自定义布局 | 高 |

### 3. 数据表格标准化

**当前问题：**
表格使用基础 HTML/自定义样式，没有统一模式。

**所需实现：**
```tsx
import { DataTable } from '@/components/ui/data-table';

<Card>
  <CardHeader>
    <CardTitle>项目列表</CardTitle>
    <CardToolbar>
      <Input placeholder="搜索..." className="w-64" />
      <Button>新建</Button>
    </CardToolbar>
  </CardHeader>
  <CardTable>
    <DataTable
      columns={columns}
      data={data}
      enableSorting
      enableFiltering
      enablePagination
      enableColumnVisibility
    />
  </CardTable>
</Card>
```

**需更新的表格：**
- 论坛话题列表
- LLM 日志表格
- 服务代理列表
- 事件日志表格
- 代理群组表格
- 已连接代理表格

### 4. 表单组件标准化

**当前问题：**
表单使用基础输入框，没有统一的分组/标签。

**所需模式：**
```tsx
<div className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="email">邮箱</Label>
    <InputGroup>
      <InputAddon mode="icon">
        <Mail size={16} />
      </InputAddon>
      <Input id="email" type="email" placeholder="you@example.com" />
    </InputGroup>
  </div>
</div>
```

**需更新的表单：**
- 登录表单 (`AdminLoginPage.tsx`)
- 代理设置表单 (`AgentSetupPage.tsx`)
- 网络发布表单 (`NetworkPublish.tsx`)
- 服务代理配置表单
- 论坛话题创建
- 文档创建弹窗

### 5. 卡片组件使用规范

**当前问题（以 AdminDashboard.tsx:541 为例）：**
```tsx
<Card className="mb-4 border-gray-200 dark:border-gray-700">
  <CardContent className="p-4 space-y-3">
```

**所需模式：**
```tsx
<Card variant="default">
  <CardHeader>
    <CardHeading>
      <CardTitle>网络状态</CardTitle>
    </CardHeading>
    <CardToolbar>
      <Button variant="ghost" size="icon">
        <RefreshCw size={16} />
      </Button>
    </CardToolbar>
  </CardHeader>
  <CardContent>
    {/* 内容无需手动设置内边距（由变体处理） */}
  </CardContent>
</Card>
```

### 6. 按钮变体标准化

**当前问题：**
页面间按钮变体使用不一致。

**所需标准：**
| 操作类型 | 变体 | 尺寸 | 示例 |
|----------|------|------|------|
| 主要操作 | `primary` | `md` | 保存、提交 |
| 次要操作 | `outline` | `md` | 取消、返回 |
| 危险操作 | `destructive` | `md` | 删除、移除 |
| 表格行操作 | `ghost` | `icon` | 编辑、查看 |
| 工具栏操作 | `outline` | `sm` | 筛选、导出 |

### 7. 导航与侧边栏

**当前问题：**
侧边栏菜单项不遵循 Metronic 模式（徽章、激活状态、图标）。

**所需更新：**
```tsx
// 带徽章的菜单项
<MenuItem>
  <MenuItemIcon><Inbox /></MenuItemIcon>
  <MenuItemTitle>消息</MenuItemTitle>
  <MenuItemBadge variant="info">5</MenuItemBadge>
</MenuItem>

// 激活状态样式
<MenuItem active={isActive}>
  {/* 激活状态：bg-accent, border-left-primary */}
</MenuItem>
```

### 8. 空状态

**当前问题：**
空状态呈现不一致。

**所需模式：**
```tsx
<Card variant="accent">
  <CardContent className="py-12 text-center">
    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
      <Inbox size={32} className="text-muted-foreground" />
    </div>
    <h3 className="text-lg font-medium mb-2">暂无数据</h3>
    <p className="text-muted-foreground mb-4">
      开始创建您的第一个项目吧。
    </p>
    <Button>创建项目</Button>
  </CardContent>
</Card>
```

### 9. 加载状态

**当前问题（以 AdminDashboard.tsx:461-471 为例）：**
```tsx
<div className="p-6 h-full flex items-center justify-center">
  <div className="text-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
```

**所需模式：**
```tsx
// 全页面加载
<Card>
  <CardContent className="py-16">
    <div className="space-y-4">
      <Skeleton className="h-8 w-[250px] mx-auto" />
      <Skeleton className="h-4 w-[200px] mx-auto" />
      <Skeleton className="h-4 w-[300px] mx-auto" />
    </div>
  </CardContent>
</Card>

// 表格加载
<DataTableSkeleton columns={5} rows={10} />
```

### 10. 对话框/弹窗标准化

**当前问题：**
对话框使用不一致的间距和按钮位置。

**所需模式：**
```tsx
<Dialog>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>确认操作</DialogTitle>
      <DialogDescription>
        此操作无法撤销。
      </DialogDescription>
    </DialogHeader>
    <div className="py-4">
      {/* 表单或内容 */}
    </div>
    <DialogFooter>
      <Button variant="outline">取消</Button>
      <Button>确认</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## 实施阶段

### 第一阶段：基础建设（第1-2周）
- [ ] 更新布局系统以匹配 Metronic 模式
- [ ] 创建标准化页面包装组件
- [ ] 更新 `CardToolbar` 实现
- [ ] 编写组件使用规范文档

### 第二阶段：核心模块（第3-4周）
- [ ] 更新管理仪表板
- [ ] 更新论坛模块
- [ ] 更新信息流模块
- [ ] 更新消息模块（部分 - 保留聊天 UI）

### 第三阶段：次要模块（第5-6周）
- [ ] 更新 Wiki 模块
- [ ] 更新文档模块
- [ ] 更新服务代理模块
- [ ] 更新 LLM 日志模块

### 第四阶段：剩余模块（第7-8周）
- [ ] 更新个人资料模块
- [ ] 更新模块管理
- [ ] 更新 AgentWorld 模块
- [ ] 更新认证页面

### 第五阶段：优化与测试（第9-10周）
- [ ] 跨浏览器测试
- [ ] 移动端响应式测试
- [ ] 深色/浅色模式验证
- [ ] 无障碍审计
- [ ] 性能测试

---

## 文件变更摘要

### 需新建的文件
```
src/components/layout/components/
  ├── page-toolbar.tsx           # 标准化页面工具栏
  ├── page-container.tsx         # 统一间距的页面包装器
  ├── empty-state.tsx            # 可复用的空状态组件
  └── loading-state.tsx          # 标准化加载状态

src/components/ui/
  ├── data-table-skeleton.tsx    # 表格加载骨架屏
  └── form-field.tsx             # 带标签的表单字段包装器
```

### 需修改的文件（高优先级）
```
src/components/layout/RootLayout.tsx
src/components/layout/components/sidebar-secondary.tsx
src/pages/admin/AdminDashboard.tsx
src/pages/forum/ForumMainPage.tsx
src/components/forum/ForumTopicList.tsx
src/pages/feed/FeedMainPage.tsx
src/components/feed/FeedView.tsx
src/pages/llmlogs/LLMLogsMainPage.tsx
src/pages/serviceagents/ServiceAgentsMainPage.tsx
```

### 需修改的文件（中优先级）
```
src/pages/wiki/WikiMainPage.tsx
src/pages/documents/DocumentsMainPage.tsx
src/pages/profile/ProfileMainPage.tsx
src/pages/messaging/MessagingMainPage.tsx
src/pages/artifact/ArtifactMainPage.tsx
```

### 需修改的文件（低优先级）
```
src/pages/NetworkSelectionPage.tsx
src/pages/AgentSetupPage.tsx
src/pages/AdminLoginPage.tsx
src/pages/OnboardingPage.tsx
```

---

## CSS/样式变更

### `globals.css` 所需更新
1. 添加 Metronic 特定的侧边栏宽度 CSS 变量
2. 添加侧边栏折叠动画关键帧
3. 添加匹配 Metronic 模式的 focus-visible 状态

### `config.metronic.css` 所需更新
1. 启用当前已导入但未使用的 Metronic 组件样式
2. 添加卡片变体的自定义工具类
3. 添加表格特定的样式工具类

---

## 成功标准

1. **视觉一致性**：所有页面遵循相同的布局模式
2. **组件复用**：常见模式不使用内联 Tailwind
3. **响应式设计**：所有页面在移动端/平板/桌面端正常工作
4. **深色模式**：所有页面完全支持深色模式
5. **无障碍**：符合 WCAG 2.1 AA 标准
6. **性能**：打包体积增加不超过 5%
7. **文档**：更新组件使用指南

---

## 风险与缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 破坏现有功能 | 高 | 增量发布，功能开关 |
| 打包体积增加 | 中 | 代码分割，懒加载 |
| 深色模式回归 | 中 | 自动化视觉回归测试 |
| 移动端布局问题 | 中 | 移动优先的开发方式 |
| 团队学习曲线 | 低 | 组件文档，示例代码 |

---

## 依赖项

- Metronic 模板 v9.3.8 文档（已提供）
- 现有 UI 组件库
- Tailwind CSS 4.x
- Radix UI 原语

---

## 验收标准

- [ ] 所有 18 个模块页面遵循一致的布局模式
- [ ] 所有数据表格使用 `DataTable` 组件
- [ ] 所有表单使用标准化的表单字段模式
- [ ] 所有卡片使用带有正确 Header/Content/Footer 的 `Card`
- [ ] 所有操作按钮在工具栏中使用一致的位置
- [ ] 所有空状态使用标准化的空状态组件
- [ ] 所有加载状态使用骨架屏模式
- [ ] 深色模式在所有页面正常工作
- [ ] 所有页面支持移动端响应式
- [ ] 当前功能无视觉回归

---

## 相关文档

- [Metronic 框架文档](./metronic-framework-docs.md)
- [Studio 组件库](../studio/src/components/ui/)
- [当前布局配置](../studio/src/config/layout-21.config.tsx)

---

## 审批

| 角色 | 姓名 | 日期 | 签名 |
|------|------|------|------|
| 产品负责人 | | | |
| 技术负责人 | | | |
| UX 设计师 | | | |
| 前端负责人 | | | |

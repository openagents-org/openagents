# 功能需求：Mod 动态配置设置页面

**版本:** 1.0
**日期:** 2024年12月28日
**作者:** OpenAgents Team
**状态:** 草稿

---

## 1. 概述

### 1.1 功能描述

在管理员控制台中创建动态设置页面系统。系统根据每个 Mod 的配置模式（config_schema）自动生成设置表单，无需为每个 Mod 单独开发设置页面。

### 1.2 核心原则

**Schema 驱动的 UI**：每个 Mod 在其 manifest 中定义配置模式，前端自动渲染相应的表单控件。

---

## 2. Schema 驱动方案说明

### 2.1 当前状态 vs 目标状态

**当前状态**：Mod 只有 `default_config`，没有类型和约束的元数据：

```json
// 当前: mods/workspace/project/mod_manifest.json
{
    "mod_name": "default",
    "default_config": {
        "max_concurrent_projects": 10,
        "auto_invite_service_agents": true
    }
}
```

**目标状态**：新增 `config_schema` 描述每个字段的类型、标签、约束：

```json
// 目标: mods/workspace/project/mod_manifest.json
{
    "mod_name": "default",
    "default_config": {
        "max_concurrent_projects": 10,
        "auto_invite_service_agents": true
    },
    "config_schema": {
        "sections": [
            {
                "id": "general",
                "title": "常规设置",
                "fields": [
                    {
                        "key": "max_concurrent_projects",
                        "type": "number",
                        "label": "最大并发项目数",
                        "description": "同时运行的最大项目数量",
                        "default": 10,
                        "min": 1,
                        "max": 100
                    },
                    {
                        "key": "auto_invite_service_agents",
                        "type": "boolean",
                        "label": "自动邀请服务代理",
                        "description": "自动将服务代理添加到新项目",
                        "default": true
                    }
                ]
            }
        ]
    }
}
```

### 2.2 配置数据流

```
┌──────────────────┐     ┌───────────────┐     ┌─────────────────┐
│ mod_manifest.json│     │  network.yaml │     │   Mod 实例      │
│                  │     │               │     │                 │
│ config_schema:   │     │ mods:         │     │ self.config:    │
│   - 字段定义     │     │   - project:  │     │   max_concurrent│
│                  │     │       max: 20 │     │   _projects: 20 │
│ default_config:  │     │               │     │                 │
│   max: 10        │     │               │     │                 │
└────────┬─────────┘     └───────┬───────┘     └────────▲────────┘
         │                       │                      │
         │  UI 从 schema 渲染   │  值保存到 yaml       │
         ▼                       ▼                      │
┌─────────────────────────────────────────────────────┐ │
│              设置弹窗 (前端)                         │ │
│                                                      │ │
│  最大并发项目数: [20        ]                        │──┘
│                                                      │ 重启时调用
│  [保存] → PUT /api/admin/mods/project/config        │ mod.update_config()
└─────────────────────────────────────────────────────┘
```

### 2.3 配置优先级

1. `default_config` (mod_manifest.json) - 基础默认值
2. `network.yaml` - 用户配置的覆盖值
3. `mod._config` - 运行时内存值

---

## 3. 用户流程

```
┌─────────────────────────────────────────────────────────────────┐
│  管理员控制台 > Mod 管理                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  已安装的 Mods                                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✅ 消息模块                              [⚙️] [开关]   │   │
│  │    线程式消息与频道功能                                  │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ✅ Wiki 模块                             [⚙️] [开关]   │   │
│  │    协作式 Wiki 带版本控制                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [⚙️] = 设置按钮（打开 Mod 设置弹窗）                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ 点击设置
┌─────────────────────────────────────────────────────────────────┐
│  消息模块设置                                          [✕]      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  常规设置                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 最大消息历史          [10000        ]                    │   │
│  │ 消息保留天数          [180          ]                    │   │
│  │ 启用线程回复          [✓ 开启]                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  文件上传                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 最大文件大小 (字节)   [10485760     ]                    │   │
│  │ 允许的文件类型        [txt, md, py, json, ...]          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│         [取消]                            [保存设置]            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ 保存
┌─────────────────────────────────────────────────────────────────┐
│  ✅ 设置保存成功！                                              │
│                                                                 │
│  ⚠️ 需要重启网络才能使更改生效。                                │
│                                                                 │
│                    [稍后重启]  [立即重启]                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 字段类型支持

| 类型 | UI 组件 | 属性 |
|------|---------|------|
| `string` | 文本输入框 | `placeholder`, `maxLength`, `pattern` |
| `number` | 数字输入框 | `min`, `max`, `step` |
| `boolean` | 开关切换 | - |
| `select` | 下拉选择 | `options: [{value, label}]` |
| `multiselect` | 多选框 | `options: [{value, label}]` |
| `list` | 动态列表 | `item_type`, `item_schema`, `max_items` |
| `object` | 嵌套表单 | `fields` (嵌套字段定义) |
| `text` | 多行文本 | `rows`, `maxLength` |
| `password` | 密码输入 | - |

### 字段定义结构

```typescript
interface ConfigField {
  key: string;           // 配置键名
  type: FieldType;       // 字段类型
  label: string;         // 显示标签
  description?: string;  // 帮助文本
  default?: any;         // 默认值
  required?: boolean;    // 是否必填

  // 类型特定属性
  min?: number;          // number 类型
  max?: number;          // number 类型
  options?: SelectOption[];  // select 类型
  item_type?: FieldType;     // list 类型的元素类型
  item_schema?: { fields: ConfigField[] };  // list<object> 类型
  fields?: ConfigField[];    // object 类型的嵌套字段
}
```

---

## 5. 组件架构

```
ModSettingsModal (设置弹窗)
├── ModSettingsHeader (标题栏)
│   ├── Mod 图标 & 名称
│   └── 关闭按钮
├── ModSettingsForm (表单区域)
│   └── SectionRenderer (分区渲染器) × N
│       ├── 分区标题
│       └── FieldRenderer (字段渲染器) × N
│           ├── StringField / NumberField / BooleanField
│           ├── SelectField / ListField / ObjectField
│           └── 帮助文本 & 错误提示
└── ModSettingsFooter (底部按钮)
    ├── 取消按钮
    └── 保存按钮
```

---

## 6. 后端 API

| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/admin/mods` | GET | 获取所有 Mod 列表及状态 |
| `/api/admin/mods/{mod_id}/config` | GET | 获取 Mod 当前配置 |
| `/api/admin/mods/{mod_id}/schema` | GET | 获取 Mod 配置模式 |
| `/api/admin/mods/{mod_id}/config` | PUT | 更新 Mod 配置 |
| `/api/admin/network/restart` | POST | 重启网络 |

### 响应类型

```typescript
// Mod 信息
interface ModInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  hasConfig: boolean;
  configSchema?: ConfigSchema;
}

// 保存配置响应
interface SaveConfigResponse {
  success: boolean;
  requiresRestart: boolean;
  message?: string;
  errors?: Record<string, string>;
}
```

---

## 7. 网络重启机制

### 7.1 架构说明

根据代码库 (`src/openagents/core/network.py`)，系统使用**网络级重启**而非单个 Mod 热重载：

```python
async def restart(self, new_config: Optional[NetworkConfig] = None) -> bool:
    """
    优雅重启网络，无需重启进程。

    步骤:
    1. 优雅关闭当前网络 (调用每个 mod.shutdown())
    2. 应用新配置 (或从文件重新加载)
    3. 重新初始化网络 (调用每个 mod.initialize())
    """
```

### 7.2 重启流程

```
用户在设置弹窗保存配置
            ↓
    配置保存到 network.yaml
            ↓
    显示"需要重启"对话框
            ↓ (用户点击"立即重启")
    POST /api/admin/network/restart
            ↓
┌───────────────────────────────────────┐
│         network.restart()             │
├───────────────────────────────────────┤
│ 1. 每个 mod: mod.shutdown()           │
│    - 优雅清理资源                      │
│                                       │
│ 2. 重新加载 network.yaml              │
│    - 获取更新后的配置值                │
│                                       │
│ 3. load_network_mods(new_config)      │
│    - 创建新的 mod 实例                 │
│    - mod.update_config(config)        │
│    - mod.bind_network(network)        │
│    - mod.initialize()                 │
└───────────────────────────────────────┘
            ↓
    所有 mod 以新配置运行
```

### 7.3 为什么选择网络重启

| 原因 | 说明 |
|------|------|
| **一致性** | 所有 mod 以全新状态重新初始化 |
| **安全性** | Mod 可能有与配置绑定的复杂内部状态 |
| **简单性** | 无需每个 mod 实现重载逻辑 |
| **现有支持** | `network.restart()` 已存在且可用 |

---

## 8. 需求列表

| ID | 需求 | 优先级 |
|----|------|--------|
| MS-01 | 根据 config_schema 自动生成设置 UI | P0 |
| MS-02 | Mod 列表页每个 Mod 显示设置按钮 | P0 |
| MS-03 | 支持 string 字段类型 | P0 |
| MS-04 | 支持 number 字段类型（含 min/max） | P0 |
| MS-05 | 支持 boolean 字段类型（开关） | P0 |
| MS-06 | 支持 select 下拉选择类型 | P0 |
| MS-07 | 支持 list 动态数组类型 | P0 |
| MS-08 | 支持 object 嵌套表单类型 | P1 |
| MS-09 | 字段分组显示（sections） | P1 |
| MS-10 | 显示字段描述作为帮助文本 | P1 |
| MS-11 | 验证必填字段 | P0 |
| MS-12 | 验证 min/max 约束 | P1 |
| MS-13 | 保存配置到 network.yaml | P0 |
| MS-14 | 保存后显示重启提示 | P0 |
| MS-15 | 重启确认对话框 | P0 |
| MS-16 | 对话框中的重启按钮 | P0 |
| MS-17 | 显示当前配置值 | P0 |
| MS-18 | 空字段显示默认值 | P1 |
| MS-19 | 未保存更改状态追踪 | P1 |
| MS-20 | 关闭前确认未保存更改 | P2 |
| MS-21 | 支持 multiselect 多选类型 | P2 |
| MS-22 | 支持 textarea 多行文本类型 | P2 |
| MS-23 | 支持 password 密码类型 | P2 |
| MS-24 | 高级设置折叠区域 | P2 |
| MS-25 | 重置为默认值按钮 | P2 |

---

## 9. Schema 迁移

### 9.1 为现有 Mod 添加 Schema

每个 Mod 的 `mod_manifest.json` 需要更新以包含 `config_schema`：

```json
{
  "mod_name": "messaging",
  "version": "1.0.0",
  "display_name": "线程消息",
  "description": "基于线程的消息系统，支持频道和私信",
  "default_config": {
    "max_message_history": 10000
  },
  "config_schema": {
    "sections": [
      {
        "id": "general",
        "title": "常规设置",
        "fields": [
          {
            "key": "max_message_history",
            "type": "number",
            "label": "最大消息历史",
            "default": 10000,
            "min": 100
          }
        ]
      }
    ]
  }
}
```

### 9.2 无 Schema 的 Mod 处理

对于没有定义 schema 的 Mod，UI 应该：
1. 显示"暂无可配置设置"消息
2. 或从 network.yaml 中现有配置自动检测基本类型

---

## 10. 验收标准

- [ ] 有配置的 Mod 显示设置按钮
- [ ] 点击设置打开带表单的弹窗
- [ ] 表单根据 config_schema 自动生成
- [ ] 所有字段类型正确渲染
- [ ] 保存更新 network.yaml
- [ ] 网络重启后配置生效
- [ ] 显示需要重启的对话框
- [ ] 重启按钮正常工作
- [ ] 验证错误正确显示
- [ ] 未保存更改警告正常工作
- [ ] 默认值正确显示

---

*文档由 OpenAgents Team 维护*

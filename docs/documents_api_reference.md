# Documents 模块 API 参考文档

本文档详细描述了 OpenAgents Documents 模块的所有 API 接口、事件格式和数据结构。

## 目录

1. [工具 API](#工具-api)
2. [事件格式](#事件格式)
3. [数据结构](#数据结构)
4. [错误代码](#错误代码)
5. [OT 操作规范](#ot-操作规范)

## 工具 API

### 文档管理

#### `create_document`
创建新的共享文档。

**参数:**
```json
{
    "document_name": "string (required)",
    "initial_content": "string (optional, default: '')",
    "access_permissions": "object (optional, default: {})"
}
```

**响应:**
```json
{
    "status": "success|error",
    "message": "string",
    "data": {
        "document_id": "string",
        "document_name": "string", 
        "creator_id": "string",
        "content": "string"
    }
}
```

**示例:**
```javascript
await client.callTool('create_document', {
    document_name: "项目文档",
    initial_content: "# 项目文档\n\n这是项目的主要文档。",
    access_permissions: {
        "user-123": "read_write",
        "user-456": "read"
    }
});
```

#### `open_document`
打开现有文档。

**参数:**
```json
{
    "document_id": "string (required)"
}
```

**响应:**
```json
{
    "status": "success|error",
    "message": "string",
    "data": {
        "document_id": "string",
        "content": "string",
        "version": "number",
        "permissions": "string"
    }
}
```

#### `close_document`
关闭文档。

**参数:**
```json
{
    "document_id": "string (required)"
}
```

#### `list_documents`
获取文档列表。

**参数:** 无

**响应:**
```json
{
    "status": "success|error",
    "data": {
        "documents": [
            {
                "document_id": "string",
                "name": "string",
                "creator_id": "string",
                "last_modified": "ISO8601 timestamp",
                "permissions": "read|read_write|admin"
            }
        ]
    }
}
```

### OT 协作编辑

#### `submit_edit_operation`
提交 OT 编辑操作。

**参数:**
```json
{
    "document_id": "string (required)",
    "revision": "number (required)",
    "operation": "array (required)"
}
```

**操作格式:**
- 正整数: 保留 N 个字符
- 字符串: 插入文本
- 负整数: 删除 N 个字符

**响应:**
```json
{
    "status": "success|error",
    "message": "string",
    "edit_id": "string"
}
```

**示例:**
```javascript
// 在位置 5 插入 "Hello "
await client.callTool('submit_edit_operation', {
    document_id: "doc-123",
    revision: 42,
    operation: [5, "Hello ", 10]  // 保留5字符，插入"Hello "，保留10字符
});
```

#### `request_document_history`
请求文档操作历史。

**参数:**
```json
{
    "document_id": "string (required)"
}
```

**响应:**
```json
{
    "status": "success|error",
    "message": "string"
}
```

**注意:** 历史数据通过 `History` 事件异步发送。

#### `request_user_identity`
请求用户身份分配。

**参数:** 无

**响应:**
```json
{
    "status": "success|error",
    "message": "string"
}
```

**注意:** 身份信息通过 `Identity` 事件异步发送。

#### `join_collaborative_session`
加入协作编辑会话。

**参数:**
```json
{
    "document_id": "string (required)",
    "user_name": "string (required)",
    "user_color": "string (optional, default: '#000000')"
}
```

**响应:**
```json
{
    "status": "success|error",
    "message": "string",
    "user_info": {
        "user_id": "string",
        "name": "string",
        "color": "string",
        "is_active": true
    }
}
```

#### `leave_collaborative_session`
离开协作编辑会话。

**参数:**
```json
{
    "document_id": "string (required)"
}
```

#### `update_cursor_position`
更新光标位置和选区。

**参数:**
```json
{
    "document_id": "string (required)",
    "cursor_position": "number (required)",
    "selection_start": "number (optional)",
    "selection_end": "number (optional)"
}
```

**响应:**
```json
{
    "status": "success|error",
    "message": "string",
    "cursor_data": {
        "cursors": ["number"],
        "selections": [["number", "number"]]
    }
}
```

#### `set_document_language`
设置文档编程语言。

**参数:**
```json
{
    "document_id": "string (required)",
    "language": "string (required)"
}
```

**支持的语言:**
- `javascript`, `typescript`, `python`, `java`, `cpp`, `c`, `csharp`
- `html`, `css`, `scss`, `json`, `xml`, `yaml`
- `markdown`, `text`, `sql`, `shell`, `dockerfile`

**响应:**
```json
{
    "status": "success|error",
    "message": "string",
    "language": "string"
}
```

### 传统编辑操作

#### `insert_lines`
插入行到文档。

**参数:**
```json
{
    "document_id": "string (required)",
    "line_number": "number (required, 1-based)",
    "content": ["string"] 
}
```

#### `remove_lines`
删除文档中的行。

**参数:**
```json
{
    "document_id": "string (required)",
    "start_line": "number (required, 1-based)",
    "end_line": "number (required, 1-based)"
}
```

#### `replace_lines`
替换文档中的行。

**参数:**
```json
{
    "document_id": "string (required)",
    "start_line": "number (required, 1-based)",
    "end_line": "number (required, 1-based)",
    "content": ["string"]
}
```

#### `add_comment`
添加行注释。

**参数:**
```json
{
    "document_id": "string (required)",
    "line_number": "number (required, 1-based)",
    "comment_text": "string (required)"
}
```

#### `remove_comment`
删除注释。

**参数:**
```json
{
    "document_id": "string (required)",
    "comment_id": "string (required)"
}
```

## 事件格式

### History 事件
当文档历史更新时发送。

**事件名:** `document.history`

**Payload:**
```json
{
    "History": {
        "start": "number",
        "operations": [
            {
                "id": "number",
                "operation": ["mixed"]
            }
        ]
    },
    "document_id": "string",
    "current_content": "string"
}
```

**处理示例:**
```javascript
function handleHistoryReceived(event) {
    const { History, document_id, current_content } = event.payload;
    
    // 应用历史操作
    applyOperationsToEditor(History.operations);
    
    // 设置当前内容
    setEditorContent(current_content);
    
    // 更新版本号
    if (History.operations.length > 0) {
        const lastOp = History.operations[History.operations.length - 1];
        currentRevision = lastOp.id;
    }
}
```

### Identity 事件
用户身份分配时发送。

**事件名:** `document.identity`

**Payload:**
```json
{
    "Identity": {
        "user_id": "string",
        "color": "string"
    }
}
```

### UserInfo 事件
用户加入/离开时发送。

**事件名:** `document.user_info`

**Payload:**
```json
{
    "UserInfo": {
        "action": "join|leave|update",
        "user_info": {
            "user_id": "string",
            "name": "string",
            "color": "string",
            "is_active": "boolean"
        }
    },
    "document_id": "string"
}
```

### UserCursor 事件
光标位置更新时发送。

**事件名:** `document.user_cursor`

**Payload:**
```json
{
    "CursorData": {
        "cursors": ["number"],
        "selections": [["number", "number"]]
    },
    "document_id": "string"
}
```

### Language 事件
文档语言更改时发送。

**事件名:** `document.language`

**Payload:**
```json
{
    "Language": {
        "language": "string"
    },
    "document_id": "string"
}
```

### Error 事件
发生错误时发送。

**事件名:** `document.error`

**Payload:**
```json
{
    "Error": {
        "type": "string",
        "message": "string",
        "details": "object"
    },
    "document_id": "string"
}
```

## 数据结构

### DocumentInfo
```typescript
interface DocumentInfo {
    document_id: string;
    name: string;
    creator_id: string;
    created_timestamp: string;  // ISO8601
    last_modified: string;      // ISO8601
    version: number;
    permissions: 'read' | 'read_write' | 'admin';
}
```

### UserInfo
```typescript
interface UserInfo {
    user_id: string;
    name: string;
    color: string;              // Hex color code
    is_active: boolean;
    joined_at?: string;         // ISO8601
}
```

### OTOperation
```typescript
type OTOperation = (number | string)[];

// 示例:
// [5, "Hello", -3, 10] 表示:
// - 保留 5 个字符
// - 插入 "Hello"
// - 删除 3 个字符  
// - 保留 10 个字符
```

### CursorData
```typescript
interface CursorData {
    cursors: number[];          // 光标位置数组
    selections: [number, number][]; // 选区数组 [start, end]
}
```

### HistoryData
```typescript
interface HistoryData {
    start: number;              // 起始版本号
    operations: OperationRecord[];
}

interface OperationRecord {
    id: number;                 // 操作 ID
    operation: OTOperation;     // OT 操作
}
```

## 错误代码

### REVISION_MISMATCH
客户端版本与服务端不匹配。

**错误详情:**
```json
{
    "client_revision": "number",
    "server_revision": "number"
}
```

**处理方式:**
1. 请求最新文档历史
2. 重新同步本地状态
3. 重新提交操作

### INVALID_OPERATION
提交的操作格式无效。

**常见原因:**
- 操作数组为空
- 操作格式不正确
- 操作超出文档范围

**处理方式:**
1. 验证操作格式
2. 重新生成操作
3. 提示用户重试

### ACCESS_DENIED
用户权限不足。

**常见原因:**
- 用户只有读权限但尝试编辑
- 用户未加入文档
- 文档已被删除

**处理方式:**
1. 检查用户权限
2. 切换到只读模式
3. 提示权限不足

### DOCUMENT_NOT_FOUND
文档不存在。

**处理方式:**
1. 验证文档 ID
2. 刷新文档列表
3. 提示文档不存在

### OPERATION_FAILED
操作执行失败。

**处理方式:**
1. 检查操作内容
2. 重新提交操作
3. 联系管理员

## OT 操作规范

### 操作类型

#### Retain (保留)
**格式:** 正整数  
**含义:** 保留指定数量的字符不变  
**示例:** `5` 表示保留 5 个字符

#### Insert (插入)
**格式:** 字符串  
**含义:** 在当前位置插入文本  
**示例:** `"Hello"` 表示插入文本 "Hello"

#### Delete (删除)
**格式:** 负整数  
**含义:** 删除指定数量的字符  
**示例:** `-3` 表示删除 3 个字符

### 操作组合规则

1. **操作顺序:** 按照文档从前到后的顺序
2. **位置计算:** 基于操作前的文档状态
3. **原子性:** 整个操作数组作为一个原子单位

### 示例操作

#### 简单插入
```javascript
// 原文档: "Hello World"
// 在位置 6 插入 "Beautiful "
const operation = [6, "Beautiful ", 5];
// 结果: "Hello Beautiful World"
```

#### 简单删除
```javascript
// 原文档: "Hello Beautiful World"
// 删除 "Beautiful " (位置 6-16)
const operation = [6, -10, 5];
// 结果: "Hello World"
```

#### 复合操作
```javascript
// 原文档: "Hello World"
// 在开头插入 "Hi ", 在 "Hello" 后插入 " Beautiful", 删除 " World"
const operation = [0, "Hi ", 5, " Beautiful", -6];
// 结果: "Hi Hello Beautiful"
```

### 操作转换示例

当两个用户同时编辑时，需要进行操作转换：

```javascript
// 原文档: "Hello World"
// 用户 A 操作: [0, "Hi ", 11]  // 在开头插入 "Hi "
// 用户 B 操作: [6, "Beautiful ", 5]  // 在 "Hello " 后插入 "Beautiful "

// 如果 A 的操作先应用:
// 1. 应用 A: "Hi Hello World"
// 2. 转换 B 的操作: [9, "Beautiful ", 5]  // 位置需要调整
// 3. 应用转换后的 B: "Hi Hello Beautiful World"
```

### 最佳实践

1. **操作最小化:** 尽量生成最小的操作
2. **批量处理:** 将连续的相同类型操作合并
3. **验证操作:** 提交前验证操作的有效性
4. **错误处理:** 妥善处理操作失败的情况

### 调试工具

#### 操作验证函数
```javascript
function validateOperation(content, operation) {
    let pos = 0;
    
    for (const op of operation) {
        if (typeof op === 'number') {
            if (op > 0) {
                // Retain
                pos += op;
                if (pos > content.length) {
                    throw new Error(`Retain beyond content length: ${pos} > ${content.length}`);
                }
            } else if (op < 0) {
                // Delete
                const deleteLen = Math.abs(op);
                if (pos + deleteLen > content.length) {
                    throw new Error(`Delete beyond content length: ${pos + deleteLen} > ${content.length}`);
                }
                pos += deleteLen;
            }
        } else if (typeof op === 'string') {
            // Insert - no position change needed
        } else {
            throw new Error(`Invalid operation type: ${typeof op}`);
        }
    }
    
    return true;
}
```

#### 操作应用函数
```javascript
function applyOperation(content, operation) {
    const result = [];
    let pos = 0;
    
    for (const op of operation) {
        if (typeof op === 'number') {
            if (op > 0) {
                // Retain
                result.push(content.slice(pos, pos + op));
                pos += op;
            } else if (op < 0) {
                // Delete
                pos += Math.abs(op);
            }
        } else if (typeof op === 'string') {
            // Insert
            result.push(op);
        }
    }
    
    // Add remaining content
    if (pos < content.length) {
        result.push(content.slice(pos));
    }
    
    return result.join('');
}
```

这份 API 参考文档提供了完整的接口规范，前端开发者可以根据这些信息正确集成 Documents 模块的所有功能。

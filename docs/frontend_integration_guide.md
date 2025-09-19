# OpenAgents Documents 模块前端集成指南

本文档为前端开发者提供 OpenAgents Documents 模块的完整集成指南，包括实时协作编辑功能的 API 接口、事件处理和最佳实践。

## 目录

1. [概述](#概述)
2. [连接和初始化](#连接和初始化)
3. [API 接口](#api-接口)
4. [事件系统](#事件系统)
5. [OT 协作编辑](#ot-协作编辑)
6. [错误处理](#错误处理)
7. [最佳实践](#最佳实践)
8. [示例代码](#示例代码)

## 概述

OpenAgents Documents 模块提供两套文档编辑功能：

### 传统文档编辑
- 基于行的操作（插入、删除、替换行）
- 文档注释系统
- 用户在线状态跟踪

### OT 协作编辑 (推荐)
- 基于 Operational Transformation 算法的实时协作
- 字符级别的精确编辑同步
- 光标和选区实时同步
- 用户身份管理和颜色标识
- 语法高亮语言切换

## 连接和初始化

### 1. 建立连接

```javascript
// 创建 WebSocket 连接到 OpenAgents 网络
const client = new OpenAgentsClient({
    endpoint: 'ws://localhost:8080/ws',
    agentId: 'frontend-user-123'
});

await client.connect();
```

### 2. 注册 Documents 模块

```javascript
// 注册文档模块事件处理
client.registerModuleHandler('documents', {
    onHistoryReceived: handleHistoryReceived,
    onIdentityAssigned: handleIdentityAssigned,
    onUserInfoUpdated: handleUserInfoUpdated,
    onCursorUpdated: handleCursorUpdated,
    onLanguageChanged: handleLanguageChanged,
    onErrorOccurred: handleErrorOccurred
});
```

## API 接口

### 文档管理

#### 创建文档
```javascript
const response = await client.callTool('create_document', {
    document_name: "我的文档",
    initial_content: "# 标题\n\n初始内容",
    access_permissions: {
        "user-456": "read_write",
        "user-789": "read"
    }
});

// 响应格式
{
    "status": "success",
    "data": {
        "document_id": "doc-uuid-123",
        "document_name": "我的文档",
        "creator_id": "frontend-user-123",
        "content": "# 标题\n\n初始内容"
    }
}
```

#### 打开文档
```javascript
const response = await client.callTool('open_document', {
    document_id: "doc-uuid-123"
});
```

#### 获取文档列表
```javascript
const response = await client.callTool('list_documents');

// 响应格式
{
    "status": "success",
    "data": {
        "documents": [
            {
                "document_id": "doc-uuid-123",
                "name": "我的文档",
                "creator_id": "frontend-user-123",
                "last_modified": "2023-12-01T10:30:00Z",
                "permissions": "read_write"
            }
        ]
    }
}
```

### OT 协作编辑 API

#### 请求用户身份
```javascript
const response = await client.callTool('request_user_identity');

// 服务端会发送 Identity 事件
```

#### 加入协作会话
```javascript
const response = await client.callTool('join_collaborative_session', {
    document_id: "doc-uuid-123",
    user_name: "张三",
    user_color: "#FF6B6B"
});
```

#### 提交编辑操作
```javascript
// OT 操作格式: [retain_count, "insert_text", -delete_count, ...]
const response = await client.callTool('submit_edit_operation', {
    document_id: "doc-uuid-123",
    revision: 42,  // 当前文档版本
    operation: [6, "Hello ", -5, 10]  // 保留6字符，插入"Hello "，删除5字符，保留10字符
});
```

#### 更新光标位置
```javascript
const response = await client.callTool('update_cursor_position', {
    document_id: "doc-uuid-123",
    cursor_position: 25,
    selection_start: 20,  // 可选
    selection_end: 30     // 可选
});
```

#### 设置文档语言
```javascript
const response = await client.callTool('set_document_language', {
    document_id: "doc-uuid-123",
    language: "javascript"
});
```

#### 请求文档历史
```javascript
const response = await client.callTool('request_document_history', {
    document_id: "doc-uuid-123"
});
```

## 事件系统

### 事件类型和处理

#### 1. History 事件 - 文档历史同步
```javascript
function handleHistoryReceived(event) {
    const { document_id, history, content } = event;
    
    // history 格式
    {
        "start": 0,
        "operations": [
            {
                "id": 1,
                "operation": [0, "Hello ", 5]
            },
            {
                "id": 2, 
                "operation": [6, "World", 5]
            }
        ]
    }
    
    // 应用历史操作到编辑器
    applyHistoryToEditor(document_id, history, content);
}
```

#### 2. Identity 事件 - 用户身份分配
```javascript
function handleIdentityAssigned(event) {
    const { user_id, color } = event;
    
    // 保存用户身份信息
    currentUser = {
        id: user_id,
        color: color
    };
    
    // 更新 UI 显示用户信息
    updateUserDisplay(currentUser);
}
```

#### 3. UserInfo 事件 - 用户进出通知
```javascript
function handleUserInfoUpdated(event) {
    const { document_id, action, user_info } = event;
    
    if (action === 'join') {
        // 用户加入
        addUserToDocument(document_id, user_info);
        showNotification(`${user_info.name} 加入了文档`);
    } else if (action === 'leave') {
        // 用户离开
        removeUserFromDocument(document_id, user_info.user_id);
        showNotification(`${user_info.name} 离开了文档`);
    }
}
```

#### 4. UserCursor 事件 - 光标同步
```javascript
function handleCursorUpdated(event) {
    const { document_id, cursor_data } = event;
    
    // cursor_data 格式
    {
        "cursors": [25, 30],      // 光标位置数组
        "selections": [[20, 30]]  // 选区数组 [start, end]
    }
    
    // 更新其他用户的光标显示
    updateOtherUsersCursors(document_id, cursor_data);
}
```

#### 5. Language 事件 - 语言切换
```javascript
function handleLanguageChanged(event) {
    const { document_id, language } = event;
    
    // 更新编辑器语法高亮
    setEditorLanguage(document_id, language);
}
```

#### 6. Error 事件 - 错误处理
```javascript
function handleErrorOccurred(event) {
    const { document_id, error_type, error_message, error_details } = event;
    
    switch (error_type) {
        case 'REVISION_MISMATCH':
            // 版本不匹配，需要重新同步
            handleRevisionMismatch(document_id, error_details);
            break;
            
        case 'INVALID_OPERATION':
            // 操作无效
            showError('操作无效: ' + error_message);
            break;
            
        case 'ACCESS_DENIED':
            // 权限不足
            showError('权限不足: ' + error_message);
            break;
            
        default:
            showError('未知错误: ' + error_message);
    }
}
```

## OT 协作编辑

### OT 操作格式

OT 操作使用简单数组格式：`[retain, "insert", -delete, ...]`

- **正整数**: 保留 N 个字符
- **字符串**: 插入文本
- **负整数**: 删除 N 个字符

### 示例操作

```javascript
// 原文档: "Hello World"
// 操作: [6, "Beautiful ", -5]
// 结果: "Hello Beautiful "

// 解释:
// - 保留前 6 个字符 "Hello "
// - 插入 "Beautiful "
// - 删除后 5 个字符 "World"
```

### 编辑器集成

#### 1. 监听编辑器变化
```javascript
editor.on('change', (delta) => {
    // 将编辑器 delta 转换为 OT 操作
    const otOperation = convertDeltaToOT(delta);
    
    // 提交操作
    submitEditOperation(documentId, currentRevision, otOperation);
});
```

#### 2. 应用远程操作
```javascript
function applyRemoteOperation(operation) {
    // 暂停本地事件监听
    editor.off('change');
    
    // 应用操作到编辑器
    const editorDelta = convertOTToDelta(operation);
    editor.applyDelta(editorDelta);
    
    // 恢复事件监听
    editor.on('change', handleLocalChange);
}
```

#### 3. 光标转换
```javascript
function transformCursor(cursorPos, operation) {
    let newPos = cursorPos;
    let currentPos = 0;
    
    for (const op of operation) {
        if (typeof op === 'number') {
            if (op > 0) {
                // Retain
                if (currentPos + op <= cursorPos) {
                    currentPos += op;
                } else {
                    break;
                }
            } else {
                // Delete
                const deleteLen = Math.abs(op);
                if (currentPos < cursorPos) {
                    if (currentPos + deleteLen <= cursorPos) {
                        newPos -= deleteLen;
                    } else {
                        newPos = currentPos;
                    }
                }
            }
        } else {
            // Insert
            if (currentPos <= cursorPos) {
                newPos += op.length;
            }
        }
    }
    
    return Math.max(0, newPos);
}
```

## 错误处理

### 常见错误类型

#### 1. REVISION_MISMATCH
```javascript
function handleRevisionMismatch(documentId, errorDetails) {
    const { client_revision, server_revision } = errorDetails;
    
    // 请求最新历史
    client.callTool('request_document_history', {
        document_id: documentId
    });
    
    // 显示同步提示
    showSyncingIndicator();
}
```

#### 2. INVALID_OPERATION
```javascript
function handleInvalidOperation(error) {
    // 记录错误
    console.error('Invalid operation:', error);
    
    // 回滚本地状态
    rollbackLocalChanges();
    
    // 提示用户
    showError('操作失败，请重试');
}
```

#### 3. ACCESS_DENIED
```javascript
function handleAccessDenied(documentId) {
    // 切换到只读模式
    setEditorReadOnly(documentId, true);
    
    // 提示用户
    showWarning('您没有编辑权限');
}
```

## 最佳实践

### 1. 连接管理
```javascript
class DocumentClient {
    constructor() {
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }
    
    async connect() {
        try {
            await this.client.connect();
            this.reconnectAttempts = 0;
        } catch (error) {
            await this.handleConnectionError(error);
        }
    }
    
    async handleConnectionError(error) {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.pow(2, this.reconnectAttempts) * 1000;
            
            setTimeout(() => {
                this.connect();
            }, delay);
        }
    }
}
```

### 2. 操作队列
```javascript
class OperationQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }
    
    async addOperation(operation) {
        this.queue.push(operation);
        
        if (!this.processing) {
            await this.processQueue();
        }
    }
    
    async processQueue() {
        this.processing = true;
        
        while (this.queue.length > 0) {
            const operation = this.queue.shift();
            await this.submitOperation(operation);
        }
        
        this.processing = false;
    }
}
```

### 3. 状态同步
```javascript
class DocumentState {
    constructor() {
        this.content = '';
        this.revision = 0;
        this.pendingOperations = [];
    }
    
    applyOperation(operation) {
        this.content = this.applyOTOperation(this.content, operation);
        this.revision++;
    }
    
    addPendingOperation(operation) {
        this.pendingOperations.push(operation);
    }
    
    confirmOperation(operationId) {
        this.pendingOperations = this.pendingOperations.filter(
            op => op.id !== operationId
        );
    }
}
```

## 示例代码

### 完整的编辑器集成示例

```javascript
class CollaborativeEditor {
    constructor(containerId, documentId) {
        this.containerId = containerId;
        this.documentId = documentId;
        this.editor = null;
        this.client = null;
        this.currentRevision = 0;
        this.users = new Map();
        this.operationQueue = new OperationQueue();
    }
    
    async initialize() {
        // 初始化编辑器
        this.editor = new Editor(this.containerId);
        
        // 初始化客户端
        this.client = new OpenAgentsClient({
            endpoint: 'ws://localhost:8080/ws',
            agentId: generateUserId()
        });
        
        // 注册事件处理
        this.client.registerModuleHandler('documents', {
            onHistoryReceived: this.handleHistoryReceived.bind(this),
            onIdentityAssigned: this.handleIdentityAssigned.bind(this),
            onUserInfoUpdated: this.handleUserInfoUpdated.bind(this),
            onCursorUpdated: this.handleCursorUpdated.bind(this),
            onLanguageChanged: this.handleLanguageChanged.bind(this),
            onErrorOccurred: this.handleErrorOccurred.bind(this)
        });
        
        // 连接并加入协作
        await this.client.connect();
        await this.joinCollaboration();
        
        // 监听编辑器变化
        this.editor.on('change', this.handleLocalChange.bind(this));
        this.editor.on('cursor', this.handleCursorChange.bind(this));
    }
    
    async joinCollaboration() {
        // 请求用户身份
        await this.client.callTool('request_user_identity');
        
        // 加入协作会话
        await this.client.callTool('join_collaborative_session', {
            document_id: this.documentId,
            user_name: '用户' + Math.random().toString(36).substr(2, 5),
            user_color: this.generateRandomColor()
        });
        
        // 请求文档历史
        await this.client.callTool('request_document_history', {
            document_id: this.documentId
        });
    }
    
    handleHistoryReceived(event) {
        const { history, content } = event;
        
        // 设置编辑器内容
        this.editor.setContent(content);
        
        // 更新版本号
        if (history.operations.length > 0) {
            const lastOp = history.operations[history.operations.length - 1];
            this.currentRevision = lastOp.id;
        }
    }
    
    handleLocalChange(delta) {
        // 转换为 OT 操作
        const operation = this.convertDeltaToOT(delta);
        
        // 提交操作
        this.operationQueue.addOperation({
            document_id: this.documentId,
            revision: this.currentRevision,
            operation: operation
        });
    }
    
    handleCursorChange(cursor) {
        // 更新光标位置
        this.client.callTool('update_cursor_position', {
            document_id: this.documentId,
            cursor_position: cursor.position,
            selection_start: cursor.selectionStart,
            selection_end: cursor.selectionEnd
        });
    }
    
    generateRandomColor() {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
            '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    convertDeltaToOT(delta) {
        // 实现 Delta 到 OT 操作的转换
        // 这里需要根据具体的编辑器实现
        return [];
    }
}

// 使用示例
const editor = new CollaborativeEditor('editor-container', 'doc-123');
await editor.initialize();
```

### React 组件示例

```jsx
import React, { useEffect, useState, useRef } from 'react';

const CollaborativeDocument = ({ documentId }) => {
    const [content, setContent] = useState('');
    const [users, setUsers] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const editorRef = useRef(null);
    const clientRef = useRef(null);
    
    useEffect(() => {
        initializeCollaboration();
        
        return () => {
            if (clientRef.current) {
                clientRef.current.disconnect();
            }
        };
    }, [documentId]);
    
    const initializeCollaboration = async () => {
        try {
            const client = new OpenAgentsClient({
                endpoint: 'ws://localhost:8080/ws',
                agentId: `user-${Date.now()}`
            });
            
            client.registerModuleHandler('documents', {
                onHistoryReceived: handleHistoryReceived,
                onUserInfoUpdated: handleUserInfoUpdated,
                onCursorUpdated: handleCursorUpdated
            });
            
            await client.connect();
            setIsConnected(true);
            
            await client.callTool('join_collaborative_session', {
                document_id: documentId,
                user_name: '前端用户',
                user_color: '#FF6B6B'
            });
            
            clientRef.current = client;
        } catch (error) {
            console.error('连接失败:', error);
        }
    };
    
    const handleHistoryReceived = (event) => {
        setContent(event.content);
    };
    
    const handleUserInfoUpdated = (event) => {
        if (event.action === 'join') {
            setUsers(prev => [...prev, event.user_info]);
        } else if (event.action === 'leave') {
            setUsers(prev => prev.filter(u => u.user_id !== event.user_info.user_id));
        }
    };
    
    const handleContentChange = (newContent) => {
        setContent(newContent);
        
        // 计算变化并提交 OT 操作
        const operation = calculateOperation(content, newContent);
        if (operation.length > 0) {
            clientRef.current?.callTool('submit_edit_operation', {
                document_id: documentId,
                revision: currentRevision,
                operation: operation
            });
        }
    };
    
    return (
        <div className="collaborative-document">
            <div className="toolbar">
                <div className="connection-status">
                    {isConnected ? '🟢 已连接' : '🔴 未连接'}
                </div>
                <div className="active-users">
                    {users.map(user => (
                        <div 
                            key={user.user_id}
                            className="user-indicator"
                            style={{ backgroundColor: user.color }}
                        >
                            {user.name}
                        </div>
                    ))}
                </div>
            </div>
            
            <textarea
                ref={editorRef}
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                className="editor"
                placeholder="开始协作编辑..."
            />
        </div>
    );
};

export default CollaborativeDocument;
```

## 总结

本文档提供了 OpenAgents Documents 模块的完整前端集成指南。关键要点：

1. **使用 OT 协作编辑** 获得最佳的实时协作体验
2. **正确处理事件** 确保状态同步和用户体验
3. **实现错误恢复** 处理网络中断和冲突情况
4. **优化性能** 使用操作队列和状态管理

如有疑问，请参考示例代码或联系后端开发团队。

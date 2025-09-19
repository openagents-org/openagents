# Documents 模块快速开始指南

本指南帮助前端开发者快速集成 OpenAgents Documents 模块的实时协作编辑功能。

## 5 分钟快速集成

### 1. 建立连接 (1 分钟)

```javascript
// 创建客户端连接
const client = new OpenAgentsClient({
    endpoint: 'ws://localhost:8080/ws',
    agentId: 'user-' + Date.now()
});

await client.connect();
```

### 2. 注册事件处理 (2 分钟)

```javascript
// 注册文档事件处理器
client.registerModuleHandler('documents', {
    // 接收文档历史和内容
    onHistoryReceived: (event) => {
        const { content } = event;
        editor.setContent(content);  // 设置编辑器内容
    },
    
    // 接收用户身份
    onIdentityAssigned: (event) => {
        const { user_id, color } = event;
        currentUser = { id: user_id, color: color };
    },
    
    // 接收其他用户的光标位置
    onCursorUpdated: (event) => {
        const { cursor_data } = event;
        updateOtherUsersCursors(cursor_data);
    },
    
    // 处理错误
    onErrorOccurred: (event) => {
        const { error_type, error_message } = event;
        console.error(`文档错误 ${error_type}: ${error_message}`);
    }
});
```

### 3. 加入协作编辑 (1 分钟)

```javascript
// 请求用户身份
await client.callTool('request_user_identity');

// 加入协作会话
await client.callTool('join_collaborative_session', {
    document_id: 'your-document-id',
    user_name: '用户名',
    user_color: '#FF6B6B'
});

// 获取文档历史
await client.callTool('request_document_history', {
    document_id: 'your-document-id'
});
```

### 4. 监听编辑器变化 (1 分钟)

```javascript
let currentRevision = 0;

// 监听编辑器内容变化
editor.on('change', async (oldContent, newContent) => {
    // 计算 OT 操作
    const operation = calculateOTOperation(oldContent, newContent);
    
    if (operation.length > 0) {
        // 提交编辑操作
        await client.callTool('submit_edit_operation', {
            document_id: 'your-document-id',
            revision: currentRevision,
            operation: operation
        });
        
        currentRevision++;
    }
});

// 监听光标变化
editor.on('cursor', async (cursorPos, selection) => {
    await client.callTool('update_cursor_position', {
        document_id: 'your-document-id',
        cursor_position: cursorPos,
        selection_start: selection?.start,
        selection_end: selection?.end
    });
});
```

## 核心概念

### OT 操作格式
使用简单数组格式：`[retain, "insert", -delete, ...]`

```javascript
// 示例：在位置 5 插入 "Hello "
const operation = [5, "Hello ", 10];  // 保留5字符，插入"Hello "，保留10字符

// 示例：删除位置 10-15 的文字
const operation = [10, -5, 5];  // 保留10字符，删除5字符，保留5字符
```

### 事件流程
1. **连接** → 请求身份 → 加入会话 → 获取历史
2. **编辑** → 生成操作 → 提交操作 → 接收广播
3. **同步** → 应用远程操作 → 更新光标 → 处理冲突

## 完整示例

```html
<!DOCTYPE html>
<html>
<head>
    <title>协作编辑器</title>
    <style>
        .editor { width: 100%; height: 400px; font-family: monospace; }
        .users { display: flex; gap: 10px; margin-bottom: 10px; }
        .user { padding: 5px 10px; border-radius: 15px; color: white; }
    </style>
</head>
<body>
    <div id="users" class="users"></div>
    <textarea id="editor" class="editor" placeholder="开始协作编辑..."></textarea>
    
    <script>
        class SimpleCollaborativeEditor {
            constructor() {
                this.client = null;
                this.editor = document.getElementById('editor');
                this.usersDiv = document.getElementById('users');
                this.currentRevision = 0;
                this.users = new Map();
                this.isApplyingRemoteChange = false;
            }
            
            async init(documentId) {
                this.documentId = documentId;
                
                // 创建客户端
                this.client = new OpenAgentsClient({
                    endpoint: 'ws://localhost:8080/ws',
                    agentId: 'user-' + Math.random().toString(36).substr(2, 9)
                });
                
                // 注册事件处理
                this.client.registerModuleHandler('documents', {
                    onHistoryReceived: this.handleHistory.bind(this),
                    onIdentityAssigned: this.handleIdentity.bind(this),
                    onUserInfoUpdated: this.handleUserInfo.bind(this),
                    onCursorUpdated: this.handleCursor.bind(this),
                    onErrorOccurred: this.handleError.bind(this)
                });
                
                // 连接并加入协作
                await this.client.connect();
                await this.joinCollaboration();
                
                // 监听编辑器变化
                this.editor.addEventListener('input', this.handleInput.bind(this));
                this.editor.addEventListener('selectionchange', this.handleSelection.bind(this));
            }
            
            async joinCollaboration() {
                // 请求身份
                await this.client.callTool('request_user_identity');
                
                // 加入会话
                await this.client.callTool('join_collaborative_session', {
                    document_id: this.documentId,
                    user_name: '用户' + Math.random().toString(36).substr(2, 5),
                    user_color: this.randomColor()
                });
                
                // 获取历史
                await this.client.callTool('request_document_history', {
                    document_id: this.documentId
                });
            }
            
            handleHistory(event) {
                const { content, history } = event;
                
                // 设置内容
                this.isApplyingRemoteChange = true;
                this.editor.value = content;
                this.isApplyingRemoteChange = false;
                
                // 更新版本
                if (history.operations.length > 0) {
                    const lastOp = history.operations[history.operations.length - 1];
                    this.currentRevision = lastOp.id;
                }
            }
            
            handleIdentity(event) {
                const { user_id, color } = event;
                this.currentUser = { id: user_id, color: color };
            }
            
            handleUserInfo(event) {
                const { action, user_info } = event;
                
                if (action === 'join') {
                    this.users.set(user_info.user_id, user_info);
                } else if (action === 'leave') {
                    this.users.delete(user_info.user_id);
                }
                
                this.updateUsersDisplay();
            }
            
            handleCursor(event) {
                // 这里可以显示其他用户的光标位置
                console.log('其他用户光标更新:', event.cursor_data);
            }
            
            handleError(event) {
                const { error_type, error_message } = event;
                
                if (error_type === 'REVISION_MISMATCH') {
                    // 重新同步
                    this.client.callTool('request_document_history', {
                        document_id: this.documentId
                    });
                } else {
                    alert(`错误: ${error_message}`);
                }
            }
            
            async handleInput(event) {
                if (this.isApplyingRemoteChange) return;
                
                // 简化的操作计算（实际项目中需要更复杂的 diff 算法）
                const newContent = this.editor.value;
                const operation = this.calculateSimpleOperation(newContent);
                
                if (operation.length > 0) {
                    await this.client.callTool('submit_edit_operation', {
                        document_id: this.documentId,
                        revision: this.currentRevision,
                        operation: operation
                    });
                }
            }
            
            calculateSimpleOperation(newContent) {
                // 这是一个简化的实现，实际项目中需要使用专业的 diff 库
                // 这里假设只是在末尾添加内容
                const oldLength = this.lastContent ? this.lastContent.length : 0;
                const newLength = newContent.length;
                
                this.lastContent = newContent;
                
                if (newLength > oldLength) {
                    // 插入操作
                    const inserted = newContent.slice(oldLength);
                    return [oldLength, inserted];
                } else if (newLength < oldLength) {
                    // 删除操作
                    const deleted = oldLength - newLength;
                    return [newLength, -deleted];
                }
                
                return [];
            }
            
            updateUsersDisplay() {
                this.usersDiv.innerHTML = '';
                
                for (const user of this.users.values()) {
                    const userDiv = document.createElement('div');
                    userDiv.className = 'user';
                    userDiv.style.backgroundColor = user.color;
                    userDiv.textContent = user.name;
                    this.usersDiv.appendChild(userDiv);
                }
            }
            
            randomColor() {
                const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
                return colors[Math.floor(Math.random() * colors.length)];
            }
        }
        
        // 使用示例
        const editor = new SimpleCollaborativeEditor();
        editor.init('your-document-id');
    </script>
</body>
</html>
```

## 常见问题

### Q: 如何处理网络断线？
```javascript
client.on('disconnect', async () => {
    // 显示断线提示
    showOfflineIndicator();
    
    // 尝试重连
    setTimeout(async () => {
        try {
            await client.connect();
            await joinCollaboration();
            hideOfflineIndicator();
        } catch (error) {
            // 重连失败，继续尝试
        }
    }, 3000);
});
```

### Q: 如何优化性能？
```javascript
// 1. 防抖处理编辑事件
const debouncedSubmit = debounce(submitOperation, 300);

// 2. 批量处理操作
const operationQueue = [];
const flushQueue = () => {
    if (operationQueue.length > 0) {
        const batchOperation = mergeOperations(operationQueue);
        submitOperation(batchOperation);
        operationQueue.length = 0;
    }
};

// 3. 使用 Web Workers 处理 OT 算法
const worker = new Worker('ot-worker.js');
worker.postMessage({ type: 'transform', op1, op2 });
```

### Q: 如何实现撤销/重做？
```javascript
class UndoRedoManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
    }
    
    addOperation(operation) {
        this.undoStack.push(operation);
        this.redoStack = []; // 清空重做栈
    }
    
    undo() {
        if (this.undoStack.length > 0) {
            const operation = this.undoStack.pop();
            const inverseOp = this.invertOperation(operation);
            this.redoStack.push(operation);
            return inverseOp;
        }
    }
    
    redo() {
        if (this.redoStack.length > 0) {
            const operation = this.redoStack.pop();
            this.undoStack.push(operation);
            return operation;
        }
    }
}
```

## 下一步

1. **深入学习:** 阅读 [完整集成指南](frontend_integration_guide.md)
2. **API 参考:** 查看 [API 参考文档](documents_api_reference.md)
3. **测试:** 运行测试用例验证集成
4. **优化:** 根据实际需求优化性能和用户体验

## 技术支持

如有问题，请：
1. 查看 API 文档和示例代码
2. 运行测试用例进行调试
3. 联系后端开发团队获取支持

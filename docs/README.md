# OpenAgents Documents 模块文档

欢迎使用 OpenAgents Documents 模块！本模块提供强大的实时协作文档编辑功能，支持多用户同时编辑、实时同步、冲突解决等特性。

## 📚 文档导航

### 🚀 快速开始
- **[快速开始指南](documents_quick_start.md)** - 5分钟快速集成协作编辑功能
- **[API 参考文档](documents_api_reference.md)** - 完整的 API 接口和数据格式说明
- **[前端集成指南](frontend_integration_guide.md)** - 详细的集成教程和最佳实践

### 🔧 开发资源
- **[测试文档](../tests/mods/README_documents_tests.md)** - 测试用例说明和运行指南
- **[示例代码](../examples/)** - 完整的示例项目和代码片段

## 🎯 功能特性

### ✨ 实时协作编辑
- **OT 算法**: 基于 Operational Transformation 的冲突解决
- **实时同步**: 毫秒级的编辑同步
- **多用户支持**: 支持无限数量用户同时编辑
- **光标同步**: 实时显示其他用户的光标位置和选区

### 🛠️ 编辑功能
- **字符级编辑**: 精确到字符的编辑操作
- **语法高亮**: 支持多种编程语言的语法高亮
- **撤销重做**: 完整的撤销重做功能
- **版本控制**: 完整的操作历史记录

### 👥 用户管理
- **身份识别**: 自动分配用户 ID 和颜色
- **在线状态**: 实时显示用户在线状态
- **权限控制**: 支持读写权限管理

### 🔒 数据安全
- **权限验证**: 严格的操作权限验证
- **错误恢复**: 完善的错误处理和恢复机制
- **数据一致性**: 保证所有用户看到一致的文档状态

## 🏗️ 架构概览

```
┌─────────────────┐    WebSocket    ┌─────────────────┐
│   前端编辑器    │ ◄──────────────► │  OpenAgents     │
│                 │                  │  Network        │
│ • 编辑器集成    │                  │                 │
│ • 事件处理      │                  │ • 事件路由      │
│ • OT 操作       │                  │ • 消息分发      │
│ • 光标同步      │                  │ • 状态管理      │
└─────────────────┘                  └─────────────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │  Documents      │
                                     │  Module         │
                                     │                 │
                                     │ • OT 引擎       │
                                     │ • 文档管理      │
                                     │ • 用户管理      │
                                     │ • 冲突解决      │
                                     └─────────────────┘
```

## 🚦 集成流程

### 1. 环境准备
```bash
# 确保 OpenAgents 服务运行
npm install openagents-client

# 或使用 CDN
<script src="https://cdn.example.com/openagents-client.js"></script>
```

### 2. 基础连接
```javascript
const client = new OpenAgentsClient({
    endpoint: 'ws://localhost:8080/ws',
    agentId: 'your-user-id'
});

await client.connect();
```

### 3. 注册事件处理
```javascript
client.registerModuleHandler('documents', {
    onHistoryReceived: handleHistory,
    onIdentityAssigned: handleIdentity,
    onUserInfoUpdated: handleUserInfo,
    onCursorUpdated: handleCursor,
    onErrorOccurred: handleError
});
```

### 4. 加入协作
```javascript
await client.callTool('join_collaborative_session', {
    document_id: 'doc-123',
    user_name: '用户名',
    user_color: '#FF6B6B'
});
```

## 📖 使用场景

### 💼 商业应用
- **在线文档编辑**: Google Docs 风格的协作编辑
- **代码协作**: 实时代码编辑和 Code Review
- **会议记录**: 多人同时记录会议内容
- **项目文档**: 团队协作编写项目文档

### 🎓 教育场景
- **在线教学**: 师生共同编辑教学材料
- **作业批改**: 老师实时批改学生作业
- **小组作业**: 学生协作完成小组项目
- **笔记共享**: 课堂笔记实时共享

### 🔬 技术场景
- **API 文档**: 团队协作编写 API 文档
- **技术规范**: 多人协作制定技术标准
- **代码注释**: 实时添加和修改代码注释
- **配置文件**: 协作编辑配置文件

## 🎨 编辑器集成

### 支持的编辑器
- **Monaco Editor** (VS Code 编辑器)
- **CodeMirror** (轻量级代码编辑器)
- **Quill** (富文本编辑器)
- **Ace Editor** (云端代码编辑器)
- **自定义编辑器** (基于 textarea 或 contenteditable)

### 集成示例
```javascript
// Monaco Editor 集成
const editor = monaco.editor.create(document.getElementById('container'), {
    value: '',
    language: 'javascript'
});

// 监听变化
editor.onDidChangeModelContent((event) => {
    const operation = convertMonacoChangeToOT(event);
    submitEditOperation(operation);
});

// 应用远程变化
function applyRemoteChange(operation) {
    const range = convertOTToMonacoRange(operation);
    editor.executeEdits('remote', [range]);
}
```

## 🔍 调试和测试

### 开发工具
```javascript
// 启用调试模式
const client = new OpenAgentsClient({
    endpoint: 'ws://localhost:8080/ws',
    agentId: 'debug-user',
    debug: true  // 启用详细日志
});

// 监听所有事件
client.on('*', (eventName, data) => {
    console.log(`事件: ${eventName}`, data);
});
```

### 测试用例
```bash
# 运行所有文档测试
python tests/run_documents_tests.py --verbose

# 运行特定测试
python -m pytest tests/mods/test_documents_ot_collaboration.py -v
```

## 🚨 常见问题

### Q: 如何处理大文档的性能问题？
**A:** 
1. 使用文档分片加载
2. 实现虚拟滚动
3. 优化 OT 操作批处理
4. 使用 Web Workers 处理复杂计算

### Q: 如何确保数据不丢失？
**A:**
1. 实现本地缓存机制
2. 定期保存文档快照
3. 监听网络状态变化
4. 实现离线编辑支持

### Q: 如何自定义用户界面？
**A:**
1. 使用 CSS 自定义样式
2. 监听事件更新 UI 状态
3. 实现自定义光标显示
4. 添加用户头像和状态

### Q: 如何扩展功能？
**A:**
1. 添加自定义事件处理
2. 扩展 OT 操作类型
3. 实现插件系统
4. 集成第三方服务

## 📞 技术支持

### 获取帮助
- **文档问题**: 查看 [API 参考文档](documents_api_reference.md)
- **集成问题**: 参考 [集成指南](frontend_integration_guide.md)
- **性能问题**: 查看最佳实践章节
- **Bug 报告**: 提交 Issue 到项目仓库

### 社区资源
- **示例项目**: 查看 examples 目录
- **测试用例**: 参考 tests 目录的实现
- **最佳实践**: 查看文档中的最佳实践章节

## 🔄 版本更新

### 当前版本: v1.0.0
- ✅ 基础 OT 协作编辑
- ✅ 多用户实时同步
- ✅ 光标和选区同步
- ✅ 错误处理和恢复
- ✅ 完整的 API 文档

### 计划功能
- 🔄 富文本编辑支持
- 🔄 文档模板系统
- 🔄 评论和批注功能
- 🔄 文档导入导出
- 🔄 移动端适配

## 📄 许可证

本项目采用 MIT 许可证，详情请查看 LICENSE 文件。

---

**开始使用**: 从 [快速开始指南](documents_quick_start.md) 开始您的协作编辑之旅！

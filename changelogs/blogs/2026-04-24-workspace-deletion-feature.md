# Workspace 彻底清理：从本地隐藏到远端软删除的完整闭环

**Date**: 2026-04-24
**Author**: Antigravity & User

## 背景与痛点
在长期开发和测试 Launcher 以及不同 Agent 连接的过程中，我们会频繁创建或加入大量测试用的 Workspace（比如 `local-ws`、`testOnlineWorkspace` 等）。随着测试次数的增加，Settings 面板里的 Workspaces 列表越来越长，变得极难管理，且此前系统缺少一个直观的“删除”或“退出”机制来清理这些历史包袱。

## 技术挑战与发现
一开始，我们的直觉是仅仅在前端增加一个按钮，并在点击时调用 `Config.removeNetwork(slug)`，把该记录从本地的 `~/.openagents/daemon.yaml` 中剔除即可。这确实能解决“眼不见为净”的问题。

但经过对 `workspace/backend` 源码的深入剖析（特别是 `routers/workspaces.py`），我们有了一个惊喜的发现：
**官方后端其实已经实现并暴露了 `DELETE /v1/workspaces/{workspace_id}` 的软删除接口！**

这意味着，我们的删除功能不能仅仅停留在本地“掩耳盗铃”，而应该是一次**完整的云端 + 本地闭环清理**。

## 架构层面的实现链路

本次功能开发贯穿了 OpenAgents 系统的四大层级，形成了完美的响应链：

1. **底层通信封装 (`WorkspaceClient`)**
   在 `packages/agent-connector/src/workspace-client.js` 中新增了 `deleteWorkspace` 方法。由于历史代码中对于 Host 的设计稍显局限，我们在调用时采用了动态提取 `network.endpoint` 的策略，确保它既能成功向官方的 `workspace-endpoint.openagents.org` 发起删除，也能精准命中私有化部署的 `http://localhost:8000`。

2. **核心业务逻辑 (`AgentConnector`)**
   在 `packages/agent-connector/src/index.js` 的 `removeWorkspace` 动作中，我们引入了**容错的保底机制**：
   - 首先尝试携带对应的 `Token` 调用远端接口，将远端数据库中的状态置为 `deleted`。
   - 然后，无论远端请求是否成功（考虑到断网或已被其他管理员清理的边缘情况），坚决执行本地 `config.removeNetwork(slug)`。
   - 彻底清除本地记录的同时，底层机制会自动解绑所有挂载于该 Workspace 的在线 Agent。

3. **IPC 通信桥梁 (`Main Process` & `Preload`)**
   在 `main.js` 中注册了 `workspace:remove` 通道。
   同时修复了一个长期潜伏的开发环境体验痛点：**优化了 `AgentManager` 中的 `loadCore()` 逻辑**，使其在开发模式下优先加载本地 `agent-connector` 源码，而非全局的陈旧安装包。这不仅消除了开发时的 `TypeError`，更对未来的本地联调扫清了障碍。

4. **用户交互层 (`Renderer`)**
   在 Settings 面板中为每一个 Workspace 添加了红色的 Remove 按钮。
   为了防止误触带来不可逆的远端数据软删，前端加入了严谨的二次确认（Confirm）弹窗。确认后，页面局部刷新（Settings 列表更新、Dashboard 状态更新、Agent 列表解绑更新）一气呵成。

## 总结
通过本次迭代，我们不仅赋予了开发者清理垃圾测试数据的能力，而且打通了一条优雅的全栈调用链路，从前端的点击事件，一路贯穿到后端的数据库软删除。这标志着 OpenAgents Launcher 在日常可用性与工程完整度上又迈出了坚实的一步！

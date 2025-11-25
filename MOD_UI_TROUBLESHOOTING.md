# 模组 UI 问题排查指南

## 问题：wiki 模组 UI 打开网页找不到

### 可能的原因和解决方案

#### 1. UI 文件未构建

**问题**：`ui/dist/` 目录不存在或为空

**解决方案**：
```bash
cd src/openagents/mods/workspace/wiki/ui
npm install
npm run build
```

构建后应该生成 `dist/index.js` 文件。

#### 2. 模组 UI 未正确发现

**检查步骤**：
1. 确认 `mod_manifest.json` 中包含 `ui` 配置
2. 确认 `ui/dist/index.js` 文件存在
3. 检查 Python 日志，查看是否有模组 UI 发现的错误

**调试**：
```python
from openagents.utils.mod_ui_loader import discover_all_mod_uis
mod_uis = discover_all_mod_uis()
print(mod_uis)
```

#### 3. 路由未正确注册

**检查步骤**：
1. 打开浏览器开发者工具，查看控制台日志
2. 查找 "✅ Loaded X mod UIs" 和 "✅ Registered mod UI route" 消息
3. 检查网络请求，确认 `/api/health` 返回了 `mod_uis` 字段

**调试**：
- 在浏览器控制台运行：
```javascript
// 检查已加载的模组 UI
import { getLoadedModUIs } from '@/utils/modUILoader';
console.log(getLoadedModUIs());

// 检查路由配置
import { getAllRoutesWithModUI } from '@/config/routeConfig';
console.log(getAllRoutesWithModUI());
```

#### 4. 静态文件服务路径问题

**检查步骤**：
1. 确认 CLI 的 HTTP 服务器正在运行
2. 尝试直接访问：`http://localhost:8050/mod-ui/openagents.mods.workspace.wiki/dist/index.js`
3. 如果 404，检查 `cli.py` 中的 `_create_studio_handler` 是否正确配置

#### 5. 模组名称不匹配

**问题**：模组名称在配置中使用的是短名称（如 "wiki"），但实际模组路径是完整路径（如 "openagents.mods.workspace.wiki"）

**解决方案**：
- 确保 `mod_manifest.json` 中的 `mod_name` 与实际的 Python 包路径匹配
- 或者在 `mod_ui_loader.py` 中使用正确的模组名称映射

### 调试清单

- [ ] UI 文件已构建（`ui/dist/index.js` 存在）
- [ ] `mod_manifest.json` 包含 `ui` 配置
- [ ] 健康检查端点返回 `mod_uis` 数据
- [ ] 浏览器控制台显示模组 UI 加载成功
- [ ] 路由已注册（检查 React Router）
- [ ] 静态文件可以访问（直接访问 URL）

### 常见错误消息

1. **"Mod UI not found"**
   - 检查模组名称是否正确
   - 检查模组 UI 是否已加载

2. **"Failed to load mod UI"**
   - 检查 `dist/index.js` 文件是否存在
   - 检查文件路径是否正确
   - 检查浏览器控制台的网络请求

3. **"No component found in mod UI entry"**
   - 检查 `index.tsx` 是否正确导出组件
   - 检查构建配置是否正确

### 快速修复步骤

1. **构建 UI**：
```bash
cd src/openagents/mods/workspace/wiki/ui
npm install
npm run build
```

2. **重启服务**：
```bash
# 重启网络服务
openagents network start
```

3. **清除浏览器缓存**并刷新页面

4. **检查日志**：
   - Python 日志：查看模组 UI 发现日志
   - 浏览器控制台：查看加载和路由注册日志


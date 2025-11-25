# Messaging Mod UI 构建说明

## 构建步骤

1. 进入 UI 目录：
```bash
cd src/openagents/mods/core/messaging/ui
```

2. 安装依赖：
```bash
npm install
```

3. 构建 UI：
```bash
npm run build
```

构建后的文件将位于 `dist/` 目录。

## 验证构建

构建完成后，应该有以下文件：
- `dist/index.js` - 主入口文件
- `dist/index.css` - 样式文件（如果有）
- `dist/assets/` - 其他资源文件（如果有）

## 注意事项

- 构建后的文件会被包含在 Python 包中
- 确保 `mod_manifest.json` 中的 `entry` 路径指向 `./ui/dist/index.js`
- 运行时不需要 Node.js，只需要预构建的文件

## 开发模式

运行开发服务器：
```bash
npm run dev
```

开发服务器将在 `http://localhost:5174` 启动（端口 5174，避免与 wiki UI 的 5173 冲突）。


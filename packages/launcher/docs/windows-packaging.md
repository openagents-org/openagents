# Windows 打包与中文路径约定

> 最后更新：2026-08-06

## 三种产物

| 产物 | 安装位置 | 权限 |
| --- | --- | --- |
| `nsis`（.exe） | `%LOCALAPPDATA%\Programs\OpenAgents Launcher` | 当前用户，无需 UAC |
| `msi` | `C:\Program Files\OpenAgents Launcher` | **全机器，需要 UAC 提权** |
| `portable` | 解压即用 | 无 |

## MSI 必须 `perMachine: true`

electron-builder 的 MSI 模板把安装目录写死为 `ProgramFiles64Folder`，但在默认配置下
（`perMachine` 未设）它同时写入 `ALLUSERS=2` + `MSIINSTALLPERUSER=1`，即"按用户安装"。
一个按用户安装却指向 `C:\Program Files` 的包，安装上下文和目标目录是矛盾的：非管理员账户
会被拒绝并回滚，装上了的机器也容易在后续触发 Windows Installer 的自修复。

所以 `build.msi.perMachine` 必须保持 `true`：模板据此写 `ALLUSERS=1`，安装器正常弹 UAC，
装进 Program Files。**不要因为"想免提权"而去掉它**——免提权要的是 NSIS 的 .exe，那条路本来
就是按用户安装的。

## "Please wait while Windows configures OpenAgents Launcher" 不是安装

双击一个**已经装过**的 MSI，Windows Installer 进入维护模式：弹出
"Please wait while Windows configures… / Gathering required information"，进度条跑完，
然后什么也不发生。这不是故障，是 MSI 语义 —— 模板里的自动启动动作条件是
`NOT Installed AND UILevel >= 4`，重装/修复时 `NOT Installed` 为假，所以它不会拉起应用。
用户看到的"进度条完成后本应该弹出 launcher，但直接消失了"就是这个。

推论：**面向普通用户的下载入口应该给 .exe（NSIS），不要给 .msi**。exe 是按用户安装、不需要
管理员、重复运行会正常重装并在结束时启动应用；MSI 留给需要 `msiexec /qn` 批量部署的场景。
下载分发由 openagents.org 的 `/api/download/launcher/windows` 决定，不在本仓库。

排查一次失败的 MSI 安装（会写出逐条动作的日志）：

```
msiexec /i "OpenAgents-Launcher-<版本>-win-x64.msi" /l*v "%TEMP%\oa-msi.log"
```

## 启动失败必须可见

`app.whenReady().then(…)` 曾经没有 `.catch`，任何启动期异常都是静默的：没有窗口、没有提示、
进程直接没了，用户只能描述成"打不开"。现在 `reportStartupError()` 兜住
`uncaughtException` / `unhandledRejection` / whenReady 链，在第一个窗口出现之前失败会弹出
错误框并写 `~/.openagents/startup.log`；窗口起来之后只记日志，不再拿掉用户正在用的界面。
同理，`second-instance` 在没有窗口可举起时会新建一个，否则点图标会毫无反应。

## 中文用户名 / 非 ASCII 路径

运行期的路径几乎都挂在 `C:\Users\<用户名>\.openagents\` 下，用户名是中文时踩过多次坑。
规则只有三条：

1. **绝不用 shell 字符串拼命令。** `execSync("\"C:\\Users\\王思瑶\\...\\node.exe\" ...")`
   经 cmd.exe 时按 OEM 代码页（中文系统是 936）重新编码，非 ASCII 路径段被破坏，表现为
   "找不到文件"或装到一个乱码目录里。一律用 `execFile` / `execFileSync` / `spawn` 的
   **数组参数**，走 CreateProcessW，路径原样以 Unicode 传下去。
2. **要写批处理就写文件，并且带 BOM + `chcp 65001`。** 见 `runTerminal()`：命令行放进
   临时 `.cmd`，文件以 UTF-8 BOM 写出，首行 `chcp 65001`，这样 `cd /d "D:\重要资料"`
   之类才不会失败。shim（如 `npm.cmd`）一律用 `%~dp0` 相对路径，不要把绝对路径写进去。
3. **解包用 `execFileSync("tar", [...])`，不要拼 `tar -xzf "..."`。** 同 1 的道理。

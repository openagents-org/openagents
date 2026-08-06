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
两者组合出来的结果是：一个不提权的安装会去写 `C:\Program Files`，非管理员账户直接失败并
静默回滚——用户看到的现象是"进度框走到一半自己消失，程序没装上"（0.9.2 的报障）。
装没装得上取决于账户是否管理员，与 Windows 显示语言、用户名是否中文无关。

所以 `package.json` 的 `build.msi.perMachine` 必须保持 `true`：模板据此写 `ALLUSERS=1`，
安装器正常弹 UAC，装进 Program Files。**不要因为"想免提权"而去掉它**——免提权要的是 NSIS
的 .exe，那条路本来就是按用户安装的。

排查一次失败的 MSI 安装（会写出逐条动作的日志）：

```
msiexec /i "OpenAgents-Launcher-<版本>-win-x64.msi" /l*v "%TEMP%\oa-msi.log"
```

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

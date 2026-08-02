# Launcher shadcn 全量重写计划

> 状态：P0 设计底座 + P1 外壳已完成，下一步 P2 轻量页
> 最后更新：2026-08-02

把 launcher 渲染层从手写 UI 全量迁移到 shadcn/ui，视觉参考 ReUI 的 `app-shell-10`（AI Agents console）。
**不引入 ReUI registry、license 或任何 `@reui/*` 依赖** —— 只借鉴其结构与观感，用 shadcn 组件实现。

---

## 一、已完成的地基（2026-08-02）

这部分已落库并通过 `typecheck` + `build` + `test`（83/83），页面代码尚未改动。

### 1.1 构建工具链升级

| 包 | 前 | 后 |
| --- | --- | --- |
| vite | 5.4.21 | **7.3.6** |
| electron-vite | 2.3.0 | **5.0.0** |
| @vitejs/plugin-react | 4.7.0 | **5.2.0** |
| @tailwindcss/vite | 4.0 | 4.3.3 |
| **react / react-dom** | 18.3.1 | **19.2.8** |

顺带消除了 vitest 4 与 vite 5 的 peer 冲突（vitest 4 要求 vite ≥ 6，升级前处于不满足状态）。
vite 8 暂不可用：electron-vite 5 的 peer 只到 `^7`。

**React 19 是必须项，不是顺带升级。** 当前 shadcn 组件是按 React 19 编写的（ref 作为普通 prop，
不再包 `forwardRef`）。在 React 18 下，任何 `asChild` 组合（`PopoverTrigger`+`Button`、
`DropdownMenuTrigger`、`TooltipTrigger`、`SidebarMenuButton`…）的 ref 都传不进去，
Radix 拿不到锚点元素——实测通知气泡定位到 `y: -249`，即渲染在屏幕外，是功能性 bug 而非警告。
替代方案是给 30+ 个 shadcn 组件手工补 `forwardRef`，既违反「简洁可靠」，也让后续 shadcn 更新无法直接落地。
升级后控制台零错误，气泡定位恢复正常（`y: 580`）。launcher 依赖完全独立
（仓库根无 `package.json`，非 npm workspace），升级不影响其他包。

### 1.2 shadcn 底座

- `components.json`：`new-york` / `neutral` / `cssVariables`，`ui` 别名指向 `@renderer/components/shadcn`。
  **必须独立目录**：现有手写组件是 PascalCase（`Button.tsx`），shadcn 是 kebab-case（`button.tsx`），
  macOS 文件系统大小写不敏感，同目录会直接互相覆盖。
- 已装 18 个组件到 `src/renderer/components/shadcn/`。
- 新增依赖：`radix-ui`、`class-variance-authority`、`cmdk`、`tw-animate-css`。

### 1.3 已修的 5 个适配坑（勿回退）

1. **暗色变体全失效** — CLI 写的 `@custom-variant dark (&:is(.dark *))` 假设 `.dark` class，
   但本项目主题走 `<html data-theme="dark">`（`store/theme.ts`）。已改为属性选择器。
2. **`accent` 语义冲突** — shadcn 的 `accent` 是菜单/命令项的**中性 hover 底色**，
   而 launcher 的 `--accent` 是品牌紫，直接用会让每个菜单项 hover 变成紫底白字。
   已重映射到 `--bg-input`；品牌紫走 `primary`。
3. **`--sidebar-width` 撞名** — shadcn `SidebarProvider` 用 inline style 设同名变量，
   旧侧栏宽度会变成「取决于它是否在 provider 内」。旧的已改名 `--legacy-sidebar-width`（P7 下线）。
4. **动画 utility 缺包** — shadcn 的 dialog/popover/sheet 依赖 `animate-in`/`zoom-in-95`，
   Tailwind v4 不内置且 CLI 不装。已补 `tw-animate-css` 并在 `globals.css` import。
5. **sidebar token** — 不用 CLI 给的两套写死调色板，改为别名到 launcher 现有 token，
   主题切换自动跟随，只维护一套。

### 1.4 顺带清理

- `tsc -b` 会把 `.js`/`.d.ts` 吐进 `src/`（composite 且无 `outDir`/`noEmit`）。已加 `noEmit` 堵住。
- 由此暴露的 `ErrorBoundary.tsx` TS2742 已加显式类型注解修复。
- `tsconfig` 移除已弃用的 `baseUrl`（TS 7 将移除），`paths` 改相对写法。
- 新增 `npm run typecheck`。

---

## 二、代码质量硬约束

### ① 组件不得冗余超长

- 单文件**硬上限 150 行**，超出必须拆。
- 页面结构统一为：`index.tsx`（只做编排，≤ 80 行）+ `components/`（展示件）+ `use-*.ts`（页面级状态编排）。
- **业务逻辑一律留在现有 `store/` 与 `hooks/`，页面不新增业务逻辑。**

当前超标文件：

| 文件 | 行数 |
| --- | --- |
| `pages/agents/index.tsx` | 1749 |
| `components/onboarding/OnboardingFlow.tsx` | 1576 |
| `pages/settings/index.tsx` | 963 |
| `pages/github/index.tsx` | 589 |
| `pages/install/index.tsx` | 542 |
| `pages/logs/index.tsx` | 516 |

### ② 禁止 Tailwind 任意值 + 固定 px

不允许 `text-[15px]`、`pt-[20px]` 这类写法。确实无法用标准 scale 表达时才可用任意值，**且必须写注释说明理由**。

当前债务：**522 处**，其中字号占 376 处
（`text-[11px]` 129、`text-[12px]` 93、`text-[10px]` 71、`text-[13px]` 61、`text-[14px]` 13、`text-[9px]` 9）。

**验收命令**（P7 必须归零）：

```bash
grep -rnE '\-\[[0-9.]+px\]' --include="*.tsx" src/renderer/pages src/renderer/components
```

### ③ 代码简洁可靠

每个 Phase 收尾必须 `typecheck` + `build` + `test` 三绿，并实际启动 Electron 肉眼验证，才进下一阶段。

---

## 三、设计 token 方案（P0 核心产出）

现有字号有 9 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 14 / 17 / 18px 共 11 档，属于失控状态。
收敛为 6 档并**整体下移一档**注册进 `@theme`，让 shadcn 组件也自动跟随桌面端的紧凑密度
（shadcn 默认大量使用 `text-sm`，覆盖它即可全局生效，无需逐组件改）：

| 类名 | 值 | 用途 |
| --- | --- | --- |
| `text-3xs` | 10px | 角标、micro badge |
| `text-2xs` | 11px | 次要说明、meta 信息 |
| `text-xs` | 12px（内置） | 密集正文 |
| `text-sm` | **13px**（覆盖，默认 14px） | 主力正文 |
| `text-base` | **14px**（覆盖，默认 16px） | 强调正文 |
| `text-lg` | **16px**（覆盖，默认 18px） | 区块标题 |
| `text-xl` | **18px**（覆盖，默认 20px） | 页面标题 |

行高需一并定义，否则覆盖字号后 `leading` 比例失配。圆角与间距同理沉淀 token。

---

## 四、阶段计划

顺序原则：先地基，再外壳，然后由轻到重逐页推进，最后统一清理。
每个 Phase 独立成一次可回退的提交。

### ✅ P0 · 设计底座（已完成）

- 字号 / 行高 token 注册进 `@theme`（见第三节）。间距沿用 Tailwind 的 4px 基准，无需自定义。
- 补装 17 个 shadcn 组件，累计 35 个（清单见附录 C）。
- 新增 `components/ui-kit/`：`StatusDot`、`PasswordInput`、`SearchInput` —— shadcn 没有、必须自建的三个。
  后两者基于 `input-group` 组合而成，不再手搓定位。
- `animate-pulse-dot` 注册进 `@theme`，替掉 `animate-[pulse-dot_1.5s_infinite]` 任意值。

### ✅ P1 · 外壳（已完成）

`components/layout/` 共 7 个文件替代原 363 行 `Sidebar.tsx`，最大文件 70 行：

| 文件 | 职责 |
| --- | --- |
| `app-shell.tsx` | `SidebarProvider` + `SidebarInset` 编排 |
| `app-sidebar.tsx` | 品牌头 + 三段结构 |
| `sidebar-nav.tsx` | 导航分组 + update badge |
| `sidebar-footer-bar.tsx` | 铃铛/主题/引导 + daemon 状态条 |
| `notification-bell.tsx` | Popover 通知中心 |
| `theme-toggle.tsx` | 三态主题切换 |
| `nav-config.ts` | 导航表 + `SHORTCUT_TABS` |

- **侧栏深色改由 token 承载**：`--sidebar*` 在 `:root` 定义为深色常量（不跟随主题，
  因为侧栏是窗口 chrome 而非页面内容），组件内一律用 `bg-sidebar` / `hover:bg-sidebar-accent`
  等语义类，20+ 个 `bg-[#0e1117]` 式硬编码色值就此消失。
- `Toast` → `sonner`：只改 `useToast.ts` 内部实现，`showToast` 签名不变，9 个页面零改动。
- `CommandPalette` 426 行 → 4 个文件共 ~300 行（`index.tsx` / `use-commands.ts` /
  `group-commands.ts` / `history.ts`）。自建的键盘导航、portal、fuzzy 匹配、
  `aria-activedescendant` 全部交给 cmdk；"最近使用"分组逻辑保留。
- 已删除：`Sidebar.tsx`、`ui/Toast.tsx`、`CommandPalette.tsx`、`--legacy-sidebar-width`。
- **TopBar 暂不动**：它由 9 个页面各自渲染（不在 `App.tsx`），留到各页重写时替换。

实测验证（Electron + CDP 截图）：侧栏 210px、深色 `#0e1117`、7 项导航、badge、
daemon 状态、字号 13px、命令面板、明暗主题均正常，控制台零错误。

### P2 · 轻量页（验证模式是否成立）

`connections` 294 → `workspaces` 447 → `credentials` 279

### P3 · 中量页

`dashboard` 452 → `install` 542（含 `AgentCard` / `AgentRow` / `Marketplace*`）→ `logs` 516

### P4 · 表单密集页

`github` 589 → `chat` 483 → `settings` 963

### P5 · 硬骨头

`agents` 1749 + `agent-detail` 全家桶（主体 419 行）。
该页有 420 行现有测试作安全网 —— **先让测试继续通过，再动结构**。

### P6 · 流程类

`OnboardingFlow` 1576 + `setup-wizard` + `GuidedTour`

### P7 · 清理与收口

- 删除 `components/ui/` 全部 19 个旧组件、旧 `Sidebar.tsx` / `TopBar.tsx`。
- 任意值 grep 归零校验。
- 补关键路径测试。
- `--legacy-sidebar-width` 等过渡 token 下线。

---

## 五、风险与回退

- **逻辑层零改动是硬红线**：`store/` `hooks/` `services/` `lib/` `types/` 共 2,477 行只保留不重写。
  确需改动时单独提交并说明理由。
- 每个 Phase 一次提交，可独立回退。
- 测试覆盖薄（仅 479 行，只覆盖 agents），因此**肉眼验证不可省**。
- 旧组件在对应页面迁完前不删，保证任何时刻都能回退到可用状态。

---

## 附录

### A. 旧 UI 组件引用面（决定替换优先级）

| 组件 | 被引用文件数 | 替代方案 |
| --- | --- | --- |
| `Button` | 35 | shadcn `button` |
| `Modal` | 14 | shadcn `dialog` |
| `Input` | 13 | shadcn `input` |
| `Label` | 7 | shadcn `label` |
| `PasswordInput` | 6 | `ui-kit` 自建（input + 可见性切换） |
| `Tabs` | 5 | shadcn `tabs` |
| `ConfirmDialog` | 5 | shadcn `alert-dialog` |
| `Badge` | 5 | shadcn `badge` |
| `Select` | 4 | shadcn `select` |
| `Switch` / `StatusDot` / `Skeleton` / `SearchInput` | 3 each | shadcn `switch` / `ui-kit` / shadcn `skeleton` / `ui-kit` |
| `Checkbox` | 2 | shadcn `checkbox` |
| `Separator` / `FormField` / `DropdownMenu` / `Card` | 1 each | shadcn 对应件 / `field` |
| `Toast` | 0（经 `useToast`） | `sonner` |

另有原生元素待替换：`<select>` 7 处、`<table>` 1 处、`<textarea>` 1 处、`<input type="checkbox">` 1 处。

### B. 命令速查

```bash
npm run typecheck   # tsc -b，不产出文件
npm run build       # electron-vite build
npm test            # vitest run

# 起 Electron 肉眼验证。两个必需项：
#   1. 必须 -u ELECTRON_RUN_AS_NODE —— 该变量若被外部设置为 1，Electron 会以纯 Node 运行，
#      `require('electron').app` 变成 undefined，启动即崩在 electron-updater 上。
#   2. --remoteDebuggingPort 让 Playwright 可 connectOverCDP 截图 / 读控制台错误。
env -u ELECTRON_RUN_AS_NODE npm run dev -- --remoteDebuggingPort=9222

# 任意值债务检查
grep -rnE '\-\[[0-9.]+px\]' --include="*.tsx" src/renderer/pages src/renderer/components

# 超长文件检查
find src/renderer -name "*.tsx" ! -path "*/shadcn/*" | xargs wc -l | sort -rn | head -20
```

### C. 已装 shadcn 组件（35）

`alert-dialog` `avatar` `badge` `breadcrumb` `button` `button-group` `card` `checkbox`
`collapsible` `command` `dialog` `dropdown-menu` `empty` `field` `input` `input-group` `item`
`kbd` `label` `popover` `progress` `scroll-area` `select` `separator` `sheet` `sidebar`
`skeleton` `sonner` `spinner` `switch` `table` `tabs` `textarea` `tooltip`

安装时的两个注意点：

- CLI 会在部分组件顶部写入 `"use client"`（即便 `components.json` 里 `rsc: false`）。
  Electron 无 RSC，已统一剥除；后续新装组件请一并检查。
- `sonner.tsx` 出厂依赖 `next-themes`，且其 `--normal-bg` 指向 `var(--popover)` ——
  本项目该变量存的是裸 HSL 通道值（`0 0% 100%`），不加 `hsl()` 包裹会得到非法颜色。
  已改为接 `useThemeStore` + 指向 `--bg-card` 等原始 token，并卸载 `next-themes`。

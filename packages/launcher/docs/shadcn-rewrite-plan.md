# Launcher shadcn 全量重写计划

> 状态：**P0–P7 全部完成**。旧 `components/ui/` 与 `TopBar` 已删除，任意值 px 归零。
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

- `components.json`：`new-york` / `neutral` / `cssVariables`，`ui` 别名指向 `@renderer/components/ui`。
  **必须独立目录**：现有手写组件是 PascalCase（`Button.tsx`），shadcn 是 kebab-case（`button.tsx`），
  macOS 文件系统大小写不敏感，同目录会直接互相覆盖。
- 已装 18 个组件到 `src/renderer/components/ui/`。
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

- 单文件**上限 300 行**，超出必须拆。
- **300 行以内不要为了凑行数而拆** —— 凭空多出的 props 透传层比长文件更糟。
  拆分按职责边界走（逻辑 → `use-*.ts`，独立展示单元 → 自己的组件），不按行数走。
- 页面结构：`index.tsx`（编排）+ `components/`（展示件）+ `use-*.ts`（页面级状态编排）。
- **业务逻辑一律留在现有 `store/` 与 `hooks/`，页面不新增业务逻辑。**

剩余超标文件（>300 行，2026-08-02 收尾时）：

| 文件 | 行数 | 判断 |
| --- | --- | --- |
| `components/onboarding/OnboardingFlow.tsx` | 847 | **不再拆**（原 1576，已拆出 6 个文件） |
| `pages/agents/index.tsx` | 571 | **不再拆**（原 1749，已拆出 4 个文件） |
| `pages/agents/components/configure-dialog.tsx` | 557 | **不再拆** |
| `pages/chat/index.tsx` | 483 | 功能定稿后再做 |
| `pages/agents/index.test.tsx` | 420 | 测试文件，不适用 |
| `components/agent-detail/AgentDetail.tsx` | 406 | **不再拆** |
| `components/notifications/NotificationCenter.tsx` | 381 | 死代码，待决定去留 |

**为什么停在这里**：这几个都是流程状态机（5 步向导、配置表单、agent 生命周期），
state 之间本质耦合。`settings` 能从 963 拆到 276，是因为它的 state 是一组互不相干的
key-value，天然能收进 `values + update`。而向导的 20 多个 state 彼此依赖，
强行抽 hook 只会制造大量 setter 透传 —— 那正是「显得过度封装」的反例，
比一个长而内聚的文件更难维护。要继续拆，正确路径是把它们重构成 `useReducer`
状态机，那属于重写而非迁移，应该单独立项。

### ② 禁止 Tailwind 任意值 + 固定 px

不允许 `text-[15px]`、`pt-[20px]` 这类写法。确实无法用标准 scale 表达时才可用任意值，**且必须写注释说明理由**。

起始债务 522 处。P0–P4 后**已迁移的页面树全部归零**，剩余集中在 P5/P6/P7 的文件里
（`pages/agents`、`components/agent-detail`、`components/onboarding`、
`components/setup-wizard`、`components/notifications`、`components/install-progress`）。

**验收命令**（P7 必须归零）：

```bash
# 排除 shadcn/（upstream 自带 ring-[3px] 之类，不算我们的债）与 ui/（P7 整个删掉）
grep -rnE '\-\[[0-9.]+px\]' --include="*.tsx" src/renderer/pages src/renderer/components \
  | grep -v '/shadcn/' | grep -v '/ui/'
```

### ③ 代码简洁可靠

每个 Phase 收尾必须 `typecheck` + `build` + `test` 三绿，并实际启动 Electron 肉眼验证，才进下一阶段。

### ④ Dialog 规范（所有对话框，无例外）

标题与底部按钮区**位置固定**，只有中间内容区滚动，且**不出现滚动条**。

这条已内建进组件，调用方按三段式写就自动满足，不要在调用点自己加高度/滚动：

```tsx
<DialogContent>          {/* flex 列 + max-h-(--dialog-max-h) + overflow-hidden */}
  <DialogHeader>…</DialogHeader>   {/* shrink-0 + 下边框 */}
  <DialogBody>…</DialogBody>       {/* flex-1 + overflow-y-auto + scrollbar-hide */}
  <DialogFooter>…</DialogFooter>   {/* shrink-0 + 上边框 */}
</DialogContent>
```

- `DialogBody` 是本项目加的（upstream shadcn 没有）。**内容可能变长时必须用它**，
  否则内容会撑开 flex 列并被 `overflow-hidden` 裁掉。
- `DialogContent` 已移除 upstream 的 `p-6`，改由三个区各自带 padding —— 这样 Header/Footer 的
  分隔线才能通栏。
- 高度上限走 `--dialog-max-h` token（`min(80vh, 45rem)`），不要写 `max-h-[80vh]` 任意值。
- `AlertDialog` 同样遵守（Footer 固定、Header 区吸收溢出），只是消息框天然短，没有独立 body。

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

### ✅ P2 · 轻量页（已完成）

三页及其全部子组件（共 22 个文件）迁完，旧 `components/ui/` 引用归零、任意值 px 归零、无文件超 300 行。

- **新增 `layout/page-header.tsx`** 替代 `TopBar`：同名 props（`title`/`subtitle`/`actions`/`showSearch`），
  各页逐个换过去，P7 即可删掉 `TopBar`。
- **Dialog 规范内建**（见第二节 ④）。新增 `DialogBody`，`Dialog`/`AlertDialog` 的 Content
  改为受高度约束的 flex 列。
- **`Badge` 增加 `success`/`warning`/`danger` 三个 soft variant** —— upstream 只有实心
  `destructive`，而本项目的状态 chip 是淡底深字。`ConnectionStatusBadge` 的 7 个状态收敛到这 4 类。
- 页面拆分：`connections` 294 → 212（+ toolbar / disconnect-dialog / use-disconnect）；
  `workspaces` 447 → 218（+ `use-workspaces-data.ts` 承接装载与派生 + stats 条）；
  `credentials` 279 → 282（+ remove-dialog；子组件 `CredentialEditor` 354 → 236 + form-fields）。
- 顺手修掉 `CredentialApplyDialog` 里 `types.map((t) => …)` 遮蔽 i18n `t` 的隐患。
- 删除 workspaces 页自建的「已复制」浮层 —— 它与 `showToast` 重复，会同时弹两个提示。

实测：三页渲染正常，控制台零错误。注意 **credentials 没有侧栏入口**（走 Ctrl+5 或命令面板），
验证时别用 `nav-credentials` 选择器。

### ✅ P3 · 中量页（已完成）

三页 + 14 个子组件迁完，旧 `ui/` 引用与任意值 px 均归零，无文件超 300 行。

- **`dashboard` 452 → 194**：`use-dashboard-data.ts`（三条轮询：agents 5s / 聚合 60s / 更新 1h）、
  `use-agent-actions.ts`（start/stop 的退避轮询确认）、`pending-updates-banner.tsx`。
- **`install` 542 → 236**：`use-marketplace.ts`（catalog 装载 + 过滤排序）、
  `use-install-actions.ts`（两段式确认的安装/卸载）、`uninstall-dialog.tsx`。
- **`logs` 516 → 151**：`use-logs.ts`（按字节偏移增量 tail + 2000 行环形缓冲 + 贴底跟随）、
  `logs-toolbar.tsx`、`log-entries.tsx`（列表 + 时间线两视图）、`clear-logs-dialog.tsx`。
- **超宽断点注册进 `@theme`**：`--breakpoint-3xl/4xl/5xl`（1920/2400/2880px），
  marketplace 网格从 `min-[1920px]:grid-cols-6` 改为 `3xl:grid-cols-6`。
- `StatsOverview` / `HealthMonitor` / `AgentCard` / `ActivityFeed` / `LogLevelBadge` 的
  inline `style={{ color: … }}` 全部改为 Tailwind 语义类。
- 又修两处 `map((t) => …)` 遮蔽 i18n `t` 的隐患（install 的 `AgentCard`、`AgentRow`）。
- 清理了 `StatsOverview` 里的死代码（`agentDiff` 恒为 null、`void connections`）。

### ✅ P4 · 表单密集页（已完成，settings 留一个尾巴）

- **`github` 589 → 250**：`use-github-feeds.ts`（每个绑定的 issue/PR feed + unbind）、
  `binding-card` / `issue-list` / `pull-list`；`GitHubBindDialog` 转 Field + Radix Select。
- **`chat` 只换组件、不重构**：该页是有意隐藏的未完成功能（`App.tsx` 不渲染它），
  等功能定稿再拆。已清掉旧 `Button`/`ConfirmDialog`，62 处任意值转 token。
- **`settings` 963 → 794**：抽出 `SettingsCard`/`Row` 与 `LauncherUpdate`，
  3 处原生 `<select>` 转 Radix Select（用 `NO_DEFAULT_AGENT` 哨兵，因为 Radix 不接受空值）。
  **⚠️ 仍超 300 行**：10 个 section 要拆，得先把 ~30 个 useState 收进 hook，属独立改动。
- **新增 `ui-kit/confirm-dialog.tsx`**（基于 AlertDialog，保持旧 props 形状）——
  这是 P7 能删掉 `ui/ConfirmDialog` 的前提。

**踩到的坑（重要）**：旧 `Button` 的 variant 命名与 shadcn **相反** ——
旧 `default`（含不写 variant）是带边框的**次要**样式，旧 `primary` 才是强调色；
shadcn 的 `default` 就是强调色。批量把 `primary→default` 是对的，
但原本写 `default`/不写 variant 的按钮会**静默变成强调色**。
后续迁移任何还在用旧 `Button` 的文件时，映射必须是：
`primary → default`、`default`/无 → `outline`、`ghost → ghost`、`destructive → destructive`。

### P5 · 硬骨头

`agents` 1749 + `agent-detail` 全家桶（主体 419 行）。
该页有 420 行现有测试作安全网 —— **先让测试继续通过，再动结构**。

### P6 · 流程类

`OnboardingFlow` 1576 + `setup-wizard` + `GuidedTour`

### ✅ P5 · agents（已完成）

`pages/agents/index.tsx` 1749 → 571，拆出 `new-agent-dialog` / `configure-dialog` /
`connect-workspace-dialog` / `auth-status`。agent-detail 全家桶（11 文件）同步迁完。
420 行现有测试全程未改动就通过 —— 它按可访问名称选择元素，不依赖 DOM 结构。

**踩到的坑**：shadcn 的 `DialogContent` 自带一个 "Close" 按钮，与 configure 对话框
footer 里原有的 Close 撞名，`getByRole` 变歧义导致 2 个测试失败。该处用
`showCloseButton={false}` 关掉内置的。

### ✅ P6 · onboarding + setup-wizard（已完成）

`OnboardingFlow` 1576 → 847，按自身步骤边界拆出 `onboarding-shared` /
`onboarding-chrome` / `steps/` 下 5 个步骤组件。setup-wizard 的 Modal 转 Dialog。

**注意**：`INSTALL_PHASE_IDS` 原本夹在两个 step 函数之间，机械切割会把它孤立，
已移进 `onboarding-shared.ts`。

### ✅ P7 · 清理与收口（已完成）

- 删除 `components/ui/`（18 个旧组件）与 `TopBar.tsx`。
- 任意值 px 全局归零（`shadcn/` 目录除外，那是 upstream 代码）。
- `--legacy-sidebar-width` 已在 P1 下线。
- **最后一处漏网**：`chat/MessageInput.tsx` 用单引号 import 旧 `Button`，
  之前所有按双引号写的扫描都没匹配到。后续做类似批量迁移记得两种引号都扫。

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

# 超长文件检查（阈值 300）
find src/renderer -name "*.tsx" ! -path "*/shadcn/*" ! -path "*/ui/*" \
  | xargs wc -l | sort -rn | awk '$1>300 && $2!="total"'
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

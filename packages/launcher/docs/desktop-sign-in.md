# 桌面端登录：需要协助的事项

> 面向：openagents.org 网站侧、workspace 前端部署、workspace 后端配置
> 提出方：launcher（桌面端）
> 日期：2026-09-10

## 一、背景

launcher 正在把 workspace 做成桌面端：同一个窗口两种模式，Launcher 模式管本机 agent，
Workspace 模式是完整的 workspace。

**除登录外都已跑通**：workspace 前端已能作为静态 bundle 打进安装包、离线加载、功能完整
（会话、文件、例程、知识库、任务、工作流、收件箱、技能中心）。web 端代码零改动，
靠一层 `next/*` 适配实现，`next build` 不受影响。

**卡住的只有登录，且现在只剩 Google / GitHub 两种。**
邮箱密码登录已经在桌面端自行打通，不再需要任何协助——原因见第六节的更正。
下面把仍然需要支持的部分列清楚。

---

## 二、网页端现在的登录链路（作为参照）

```
浏览器
  │  goToCentralLogin()
  ▼
openagents.org/login?returnTo=<workspace 页面 URL>
  │  用户用 Google / GitHub / 邮箱密码登录
  │  铸造一次性 Firebase custom token（POST /v1/auth/workspace-handoff）
  ▼
workspace.openagents.org/auth/callback?ct=<custom token>&returnTo=<原页面>
  │  ├─ 常规：signInWithCustomToken(ct)  → Firebase 会话（本 origin）
  │  └─ 连不上 Google：POST /v1/auth/session → 30 天 workspace session JWT
  ▼
回到 returnTo，已登录
```

关键点：**登录态建立在 `workspace.openagents.org` 这个 origin 上**，靠浏览器的
per-origin 存储保持。

---

## 三、桌面端多出来的两条约束

这两条不是实现选择，是外部规则，任何做法都绕不过：

1. **Electron 没有一个 http origin 可以接收 OAuth 回调。**
   桌面应用的页面从本地加载，没有域名可以让 openagents.org 回跳。

2. **Google 拒绝在应用内嵌窗口里完成认证**（报「此浏览器不安全」），GitHub 同类风险。
   所以这两种登录必须发生在用户的真实浏览器里，登录结果再交回应用。

---

## 四、三种登录方式分别需要什么

| 登录方式 | 桌面端做法 | 需要协助 |
|---|---|---|
| 邮箱密码 | 应用内表单，直接调现有账号接口 | **无**，已完成 |
| GitHub | 只能浏览器完成，结果回传 | 需部署 `/auth/desktop` 页面 |
| Google | 只能浏览器完成，结果回传 | 需部署同一个页面 |

邮箱密码走的是 openagents.org 登录页自己那条链路（第六节），
桌面端复用即可，不需要新接口。Google / GitHub 受第三节两条约束限制，
必须在浏览器里完成，需要一个页面把结果交回应用。

---

## 五、需要协助的清单

### 1【最高优先】部署 `/auth/desktop` 落地页（workspace 前端）

**这一项一次性解决三种登录方式，且不需要后端改动。**

代码已经写好并有测试，在分支 `feat/launcher-workspace-desktop`：
- `workspace/frontend/app/auth/desktop/page.tsx`
- `workspace/frontend/lib/desktop-handoff.ts`（含单测 `desktop-handoff.test.ts`）
- `workspace/frontend/app/auth/callback/page.tsx` 的 13 行改动

**它做什么：**

```
launcher 起一个本机回环端口（随机端口 + 一次性 state）
  │  用系统浏览器打开
  ▼
workspace.openagents.org/auth/desktop?port=<端口>&state=<随机串>
  │  ├─ 本 origin 已有 session → 直接转发给回环端口，结束
  │  └─ 没有 session → 跳 openagents.org/login?returnTo=<本页 URL>
  ▼
（走完现有的登录链路，回到 /auth/desktop）
  │  这次读到 session → POST 到 http://127.0.0.1:<端口>/desktop-auth
  ▼
launcher 校验 state，存下 30 天 session，关闭端口
```

**为什么 returnTo 必须指向 `/auth/desktop` 这样的普通页面**（实测踩过的坑）：
把 returnTo 直接指向 `/auth/callback` 时，openagents.org 会把它当作最终目的地直接跳过去，
**不铸造 custom token**，callback 页拿不到 `ct`，登录静默失败。
所以中转页必须是一个普通页面，让现有链路照常走完。

**callback 页那 13 行改动做什么：**
桌面端的登录必须走服务端兑换（`POST /v1/auth/session`）拿 30 天 session，
不能用 Firebase 会话——Firebase 的 ID token 一小时过期，refresh token 留在页面里，
桌面应用**存不下来**。判断依据是 User-Agent 里的 `OpenAgentsLauncher` 标记。

**需要确认的一点**（我们无法自测）：
openagents.org 的 `returnTo` 白名单是否接受
`https://workspace.openagents.org/auth/desktop?port=..&state=..`（带 query 的 workspace 域 URL）。
实测它确实会把 returnTo 原样回传（query 未被剥离），但那次是指向 `/auth/callback` 的情形。

---

### 2【最高优先】CORS 放行桌面端 origin（workspace 后端配置）

**与登录并列的阻塞项**，登录解决了这项不解决同样用不了。

桌面端的 workspace 从本地加载，origin 是自定义 scheme `openagents://workspace`，
不在 API 的 CORS 白名单里，**所有接口调用在预检阶段就被拒**。

实测：

```
Origin: https://workspace.openagents.org  → 200 ✓
Origin: http://localhost:3001             → 200 ✓
Origin: openagents://workspace            → 400 ✗（预检被拒）
```

**需要的改动**：部署环境变量 `CORS_ORIGINS` 增加一项 `openagents://workspace`。
后端代码不用动（`app/main.py` 已经从该变量读白名单）。

目前桌面端在主进程里改写请求头绕过，**这是过渡手段**，配置加上后那段代码会删掉。

---

### 3【已撤回】~~openagents.org 提供登录 API~~

原先这里请求「一个接受邮箱+密码的接口」。**接口一直就有，是我们找错了地方**，
详见第六节的更正。桌面端已按网页端同一条链路实现，此项不需要任何协助。

---

## 六、更正：邮箱密码本来就有接口，在第三个域名上

先前这份文档断言「openagents.org 的邮箱账号是网站自有体系，需要新接口」。
**结论错了。** 把 openagents.org 的登录页 chunk 读出来后，真实链路是：

```
POST endpoint.openagents.org/v1/auth/login              {email, password}
  → {code:200, data:{access_token, refresh_token, user:{email, display_name}}}
POST endpoint.openagents.org/v1/auth/workspace-handoff  Bearer access_token
  → {custom_token, workspace_app}
POST workspace-endpoint.openagents.org/v1/auth/session   {custom_token}
  → 30 天 workspace session JWT
```

错在把账号 API 认成了 workspace 后端。实际有三个服务：

| 域名 | 是什么 | 邮箱密码 |
|---|---|---|
| `openagents.org` | Next.js 站点，自身只有 `/api/geo` | 只有页面，无接口 |
| `endpoint.openagents.org` | 账号服务（`NEXT_PUBLIC_OPEN_DISCOVERY_API_URL`） | **在这里** |
| `workspace-endpoint.openagents.org` | workspace 后端 | 只认 custom token |

网页登录页解构的是 `loginWithCustomAuth`，**没有解构 Firebase 的 `login`**——
邮箱密码在网页端也早已不走 Firebase。Firebase 项目是同一个
（web API key 与桌面端一致，`openagentsweb`），但如今只承载 Google / GitHub / Apple。
所以「同一密码网页接受、Firebase 拒绝」不是账号体系不同，
而是那个账号根本不在 Firebase 里。

其余仍然成立的事实：

| 事实 | 验证方式 |
|---|---|
| 上述三个接口生产全部在线 | 401 / 400 而非 404 |
| `POST /v1/auth/session` 生产已启用 | 无效 token 返回 401 而非 503 |
| API 的 CORS 是白名单而非 `*` | 见第五节 2 三个 origin 的预检结果 |
| returnTo 指向 callback 页会导致不铸 token | 实测落地 URL 带 `desktop` 参数但无 `ct` |

---

## 七、桌面端这边已经完成的部分

供判断边界，这些不需要协助：

- workspace 前端的桌面构建（Vite 第二构建目标，web 端不受影响）
- 本地 bundle 的打包、协议伺服、离线加载
- 回环服务：随机端口、一次性 state、超时、单次使用，含单测
- session 存储与续期、跨进程注入
- 一键授权本机（复用现有配对码接口，后端零改动）
- 主题与语言在两侧双向同步
- **应用内邮箱密码登录**（第六节那条链路，三个接口都是现成的，零部署依赖）

---

## 八、最小行动清单

邮箱密码已经可用，下面三项只影响 Google / GitHub：

1. **部署 `/auth/desktop` 页面**（前端，代码现成，含测试）
2. **`CORS_ORIGINS` 增加 `openagents://workspace`**（部署配置，一行）
3. 确认 openagents.org 的 returnTo 白名单接受带 query 的 workspace 域 URL

~~4. openagents.org 提供邮箱密码登录 API~~ —— 已撤回，见第六节。

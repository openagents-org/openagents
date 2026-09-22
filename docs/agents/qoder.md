# Qoder

[Qoder](https://qoder.com) — Alibaba's coding agent CLI — run as an OpenAgents
agent.

Unlike most agents in this catalogue, Qoder ships as **two separate builds**.
The adapter drives either one; which one you get is a configuration choice, not
a separate agent type.

| Edition | Binary | Config / sign-in | Install |
| --- | --- | --- | --- |
| International | `qodercli` | `~/.qoder` | `curl -fsSL https://qoder.com/install \| bash` |
| China (中国版) | `qoderclicn` | `~/.qoder-cn` | `curl -fsSL https://static.qoder.com.cn/qoder-cli-cn/install.sh \| bash` |

They are independent installs with **independent accounts**: signing in to one
says nothing about the other. There is no single switch that moves a session
between the two sites.

The launcher installs the international build with npm
(`npm install -g @qoder-ai/qodercli`) into its isolated runtime. The China build
is installed on its own with `npm install -g @qodercn-ai/qoderclicn` or the
script above.

---

## What the adapter does

```
qodercli -p --output-format stream-json \
  --append-system-prompt <workspace briefing> \
  --permission-mode bypass_permissions \
  --disallowed-tools … --mcp-config <config> [--resume <session>]
```

One process per user message; the prompt is piped over stdin. Workspace tools
(`workspace_read_file`, the shared browser, todos, …) arrive through the same
stdio MCP server the Claude adapter uses, so the briefing is the same one —
reused rather than forked.

Session continuity is per channel: the CLI's `session_id` comes back on its
init frame, is stored against the working directory, and is replayed with
`--resume` on the next turn. A resume that produces nothing is treated as a
pruned transcript — the binding is dropped and the turn re-runs once, fresh.

## Three differences from Claude Code worth knowing

Qoder speaks Claude Code's stream-json contract, but the CLI surface is not
identical:

- **`-p` is a boolean.** It takes no value; the turn is either positional or
  piped. This adapter pipes, so a long briefing can never hit the OS argv limit
  and a quote in a user message is not a quoting problem.
- **There is no `--verbose`.** stream-json streams without it, and passing one
  is a hard `unknown option` error.
- **Tool flags are kebab-case.** `--disallowed-tools`, not `--disallowedTools`.

## Choosing the edition

`QODER_REGION` pins one (`international` or `china`). Leave it blank and the
adapter prefers the build that is actually signed in — its `<config>/.auth/user`
exists — falling back to international. That means a machine with only one
account needs no configuration at all.

## Permissions

Headless runs use `--permission-mode bypass_permissions`, because there is
nobody at a terminal to answer a permission prompt. A workspace running the
agent in **plan mode** instead passes `--permission-mode plan`, which
investigates and proposes without writing.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Not signed in" | The edition in use has no session. Run `qodercli` (or `qoderclicn`) in a terminal and sign in, or set `QODER_REGION` to the edition you did sign in to. |
| The agent answers as the wrong account | Both builds are installed and the other one is signed in. Set `QODER_REGION` explicitly. |
| "below the minimum supported version" | The CLI is older than the 1.x line that ships the stream-json contract. Upgrade with `qodercli update` or the install script. |

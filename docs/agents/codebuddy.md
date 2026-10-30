# CodeBuddy Code (and WorkBuddy)

[CodeBuddy Code](https://www.codebuddy.ai) — Tencent's terminal agent, installed
as `@tencent-ai/codebuddy-code` — run as an OpenAgents agent.

This page exists mostly to answer one question: **can WorkBuddy join a
workspace?** The short answer is yes, through this agent, with one real caveat.

## WorkBuddy and CodeBuddy are the same engine

[WorkBuddy](https://www.workbuddy.cn) is a desktop application. It has no
command line, no documented local port, and no public API of its own — the only
official programmable surface in the family is the
[Managed Agents API](https://www.codebuddy.cn/apiDocs/cloud-agent.html), which
runs agents in Tencent's cloud sandbox and needs an enterprise key.

But the desktop app does not implement an agent. It **spawns this CLI** in a
sidecar (`codebuddy --serve`) and talks to it over local ACP:

```
WorkBuddy (Electron) → daemon app server → sidecar → codebuddy --serve → ACP → the window you see
```

The published CLI still carries the seams: `CODEBUDDY_HOST=workbuddy-desktop`,
`WORKBUDDY_CONFIG_DIR`, a `workbuddy` authentication platform, and
`www.workbuddy.cn` in its own product configuration. So driving the CLI directly
gets the same engine and the same account, with none of the fragility of
reverse-engineering a loopback port that only exists while a GUI is open.

**The caveat:** WorkBuddy's office abilities — decks, documents, spreadsheets —
come from skills, plugins and MCP apps bundled *inside the desktop application*.
They are not in the npm package. This agent is therefore the coding and general
terminal agent, not the deck-and-spreadsheet one.

---

## What the adapter does

```
codebuddy -p --output-format stream-json --verbose \
  --append-system-prompt <workspace briefing> -y \
  --disallowedTools … --mcp-config <config> [--resume <session>]
```

One process per user message; the prompt is piped over stdin. Workspace tools
(`workspace_read_file`, the shared browser, todos, …) arrive through the same
stdio MCP server the Claude adapter uses, so the briefing is the same one —
reused rather than forked.

Session continuity is per channel: the CLI's `session_id` comes back on its
first frame, is stored against the working directory, and is replayed with
`--resume` on the next turn. A resume that produces nothing is treated as a
pruned transcript — the binding is dropped and the turn re-runs once, fresh.

## The exit code means nothing

Worth knowing before you debug anything here. A run whose model call failed
outright still exits **0**:

```json
{"type":"result","subtype":"error_during_execution","is_error":true,
 "errors":["504 …"],"errors_info":[{"status":504,"category":"network"}]}
```

The verdict therefore comes from the **result frame**, never the exit code —
otherwise a 401 would be posted into the channel as a successful empty answer.
`errors_info[].category` is `auth`, `quota`, `network` or `model_service`, and
each maps to its own message. That structure is also why classification does not
regex the CLI's own error text: on a China-site account that text is Chinese.

The one case with no frame to read is a hard startup failure, which writes to
stderr and *also* exits 0. That is the only path where stderr is used.

## Signing in

Two ways, and the agent needs exactly one:

| | |
|---|---|
| **API key** | `CODEBUDDY_API_KEY`, or `CODEBUDDY_AUTH_TOKEN` for a platform/enterprise token. Set it in the launcher and nothing else is needed. |
| **Account sign-in** | Run `codebuddy` in a terminal and use `/login`. There is no `codebuddy login` subcommand — signing in is a slash command inside the session — which is why the launcher opens the CLI rather than a login command. |

The credential a `/login` writes lands under
`~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/` (macOS),
`%LOCALAPPDATA%\CodeBuddyExtension\…` (Windows), or
`~/.local/share/CodeBuddyExtension/…` (Linux). The launcher does not read it:
the agent is registered as `unverifiable`, so readiness stays honest — "sign-in
not confirmed" until a task confirms it — instead of guessing from a file whose
mere existence proves nothing.

## Sites are separate accounts

`CODEBUDDY_REGION` picks which one the CLI talks to:

| Value | Site | Effect |
|---|---|---|
| `international` (default) | codebuddy.ai / workbuddy.ai | The CLI's own endpoint. |
| `china` | codebuddy.cn / workbuddy.cn | Sets `CODEBUDDY_INTERNET_ENVIRONMENT=internal`. |

An account exists on one site only. Choosing the wrong one does not fail as a
routing error — it fails as a sign-in error, which is exactly the confusing
outcome this field exists to prevent. `CODEBUDDY_BASE_URL` overrides the
endpoint entirely, for an enterprise or self-hosted deployment.

## Tools that are turned off

`AskUserQuestion` and `AskUserForStructuredInput` would suspend a headless run
waiting for a person who is not there. `WeChatReply`, `WeComReply` and
`PushNotification` would deliver to the user's own accounts from an agent they
pointed at a workspace channel. `CronCreate` / `CronDelete` / `CronList` are
banned as in the Claude adapter — scheduling belongs to the workspace's timers,
which the agent reaches over MCP.

In plan mode the run is `--permission-mode plan`; otherwise it is `-y`
(`bypassPermissions`), because nobody is at the keyboard to approve a tool call.

## Storage

| Path | Contents |
|---|---|
| `~/.openagents/sessions/<workspace>_<agent>_codebuddy.json` | The CLI session id per channel, and the working directory it was created under. |
| `~/.openagents/mcp-configs/codebuddy-*.json` | The workspace MCP config for one run. Written `0600` and deleted when the run ends — it carries the workspace token. |

## Troubleshooting

| Symptom | Cause |
|---|---|
| "CodeBuddy CLI not found" | `npm install -g @tencent-ai/codebuddy-code`. The standalone build from `codebuddy.cn/cli/install.sh` works too, as long as it is on PATH. |
| "below the minimum supported version 2.0.0" | Older releases have no `stream-json` contract to parse. Upgrade. |
| "CodeBuddy rejected the credentials (401/403)" | The key is wrong or expired, **or** the CLI is signed out — the two are indistinguishable from outside. Check the site setting first; a valid key on the wrong site fails this way. |
| "rate limited or out of credits" | The account's quota. CodeBuddy bills in credits. |
| Answers arrive but tools do nothing | The MCP config could not be written or the `openagents` binary was not found; the run proceeds without workspace tools and says so in the daemon log. |

## Not supported yet

- **Attachments** are flattened into the prompt as text.
- **WorkBuddy's office skills** — see the caveat at the top.
- **The Managed Agents (cloud) API** is not bridged; this agent runs on the
  user's own machine.

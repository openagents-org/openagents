# CodeArts Agent (码道)

Huawei Cloud's code agent CLI, run headless by the OpenAgents daemon.

- Registry entry: `registry/codearts.json`
- Adapter: `packages/agent-connector/src/adapters/codearts.js` (extends `opencode.js`)
- Product page: https://codearts.huaweicloud.com

## What it is

The CodeArts Agent CLI is built on OpenCode. The binary Huawei ships
(`agentkernel`, installed as `codearts`) exposes OpenCode's command set —
`run`, `models`, `session`, `auth`, `serve`, `acp` — and `run --format json`
streams OpenCode's JSON events. The adapter therefore reuses OpenCodeAdapter for
stream parsing, sessions, stop control and failure classification, and overrides
only how the CLI is found, launched and authenticated.

Checked against CLI 26.9.3 (Windows x64).

## Install

Huawei's own script, not npm:

| Platform | Command |
|---|---|
| macOS / Linux | `curl -fsSL https://cnnorth4-cloudide-marketplace.obs.cn-north-4.myhuaweicloud.com/codearts/cli_tui/install_script/install.sh \| bash` |
| Windows | `irm https://cnnorth4-cloudide-marketplace.obs.cn-north-4.myhuaweicloud.com/codearts/cli_tui/install_script/install.ps1 \| iex` |

The script installs into `~/.codeartsdoer/installers`:

```
~/.codeartsdoer/installers/
├── codearts            wrapper script (sets the CLI environment, then runs bin/)
├── codearts.cmd        Windows wrapper
└── bin/codearts(.exe)  the CLI itself (agentkernel, renamed)
```

It adds `~/.codeartsdoer/installers` to the user PATH (shell rc file / user
`Path`), which an already-running app never sees, so `paths.js` lists that
directory explicitly.

The adapter runs `bin/codearts(.exe)` directly with the wrapper's environment
rather than the wrapper: on Windows the `.cmd` needs a cmd.exe host, and an
attached console makes an OpenCode-based CLI open its TUI instead of running
headless. The wrapper also sets `NODE_TLS_REJECT_UNAUTHORIZED=0`; the adapter
does not, so certificate checks stay on.

## Authentication

Non-interactive commands accept one credential: a Huawei Cloud access key pair
in `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK`. The browser sign-in the TUI offers does
not apply to them. Without the pair, `auth list`, `models` and `run` all print:

```
认证失败，没有设置环境变量CODEARTS_CLI_AK/CODEARTS_CLI_SK
请在华为云统一身份认证页面申请AK/SK，通过配置环境变量的方式使用cli命令。
具体操作请参考以下指引：https://codearts.huaweicloud.com/portal/settings/cli-auth
```

The account also needs a CodeArts seat; the CLI refuses with "Seat revoked" or
"assign a seat to you" otherwise. Both are classified as `auth_failed`.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `CODEARTS_CLI_AK` | yes | Access key ID |
| `CODEARTS_CLI_SK` | yes | Secret access key |
| `CODEARTS_MODEL` | no | `provider/model`. Left empty, the adapter runs the first model `codearts models` lists for the access key (cached per key), and `huaweicloud-maas/GLM-5.2` only when that list can't be read. The launcher's model field loads the same list. |

A model is always passed: an OpenCode-based `run` with none waits for an
interactive choice.

Which models an access key may run is decided per account. The
`huaweicloud-maas/deepseek-v3.2` from Huawei's getting-started guide was not
in a real account's list (2026-09-15: GLM-5.2, GLM-5.2-ArkTS-SPARK,
OpenPangu-2.0-Flash, OpenPangu-2.0-Pro), which is why no model id is
hard-coded as the default any more.

`codearts models` prints a table (`model_id  model_name`), not OpenCode's one
id per line.

A model the account cannot use is reported on stderr and the CLI still exits 0
with an empty stdout:

```
error: 未找到模型：huaweicloud-maas/deepseek-v3.2，该模型不存在，或当前未登录。请重新登录或者查看可用模型列表
```

The CLI prints a chunk of its bundled source before that line, so the adapter
classifies only the `error:` line, as `model_not_found`.

## How a message runs

```
codearts run --format json --auto --model <model> [--session <id>]
```

- The prompt is written to stdin.
- `run` has no `--dir`; the working directory is the spawn cwd.
- `--auto` (always_allow) — a headless run has nobody to answer a permission
  prompt, the same choice every other adapter makes.
- The session id from the event stream is stored per channel and passed back
  with `--session`.

## Not yet verified

- A complete `run` with a real access key: the JSON event stream is assumed to
  match OpenCode's, based on the shared command set and the help output. Verify
  with an account before relying on it, and adjust `opencode.js` parsing only if
  the events differ.
- Where `codearts upgrade` and the installer disagree on layout in future
  versions.

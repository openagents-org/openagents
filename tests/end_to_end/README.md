# Launcher end-to-end test

One script, three platforms. It walks the desktop launcher through the whole
user journey, per agent, on the machine it runs on:

```
pair a workspace → install the agent → create an instance → configure its
credentials → connect it to the workspace → start it → send it a message →
read its answer
```

```bash
node tests/end_to_end/run.js                 # every agent in the config file
node tests/end_to_end/run.js --agents=claude # just one
node tests/end_to_end/run.js --fresh         # from an empty profile (slow, thorough)
```

Exit code is `0` only when every agent that had credentials passed. Results land
in `~/.openagents-e2e/runs/<timestamp>/` (`results.json`, `summary.md`,
`run.log`, plus per-agent diagnostics for anything that failed) and the newest
run is always copied to `~/.openagents-e2e/latest.json`.

## How it drives the app

Through the launcher's **control server** — a loopback HTTP surface the app
opens when started with `--control-port=N` (see
`packages/launcher/src/main/control-server.ts`). Behind it sits the same
`AgentManager` the UI calls over IPC, so a green run means the desktop path
works, not that some parallel CLI does.

No display is involved: the run starts the app `--headless`, which is what makes
a scheduled job on a Windows box over SSH — where there is no desktop session at
all — possible. GUI-level coverage lives in `packages/launcher/e2e/` (Playwright)
and is a different job.

Each run gets its own `HOME` (`~/.openagents-e2e/home` by default), so
`~/.openagents` — portable node, core library, daemon config, agent runtimes —
and the Electron profile are the test's, not yours. Your own launcher can stay
open while a run is in progress.

## What the isolated profile does and does not cover

The run gets its own `HOME`, so `~/.openagents` and the Electron profile are the
test's. It does **not** get its own `PATH`: an agent CLI installed globally on
the machine is visible to the launcher inside the run, and the catalog reports
it as already installed — so its install step is skipped even under `--fresh`.
That matches what the launcher itself would see on that machine, but it means a
box where you develop is not the place to prove the from-nothing install path.
Use a machine that has no agent CLIs of its own for that (which is what a
dedicated daily runner is).

## Configuration

Copy the example and fill it in — the file is gitignored:

```bash
cp tests/end_to_end/agents.example.json tests/end_to_end/agents.config.json
```

The config file **is** the matrix: an agent is tested because it has an entry,
skipped (with the reason in the report) when it carries a `skip`, and skipped
too when its required credentials are missing. `apiKey` / `baseUrl` / `model`
are mapped onto whatever variables the launcher's own Configure dialog asks for
(`GET /agents/env-fields` → `*_API_KEY`, `*_BASE_URL`, `*_MODEL`), so a registry
change lands here without an edit. Anything off that convention goes in `env`;
agents that read a file instead of the environment (Hermes) use `files`.

`workspace.token` must be an owner/admin credential — it is what mints the
pairing code.

Everything can come from the environment instead, which is what a CI or a
scheduled job usually wants:

| Variable | Meaning |
| --- | --- |
| `OA_E2E_WS_API` | Workspace API base (default `https://workspace-endpoint.openagents.org`) |
| `OA_E2E_WS_TOKEN` | Workspace token (owner/admin) |
| `OA_E2E_WS_ID` | Workspace id or slug |
| `OA_E2E_<AGENT>_API_KEY` | Per-agent key, e.g. `OA_E2E_CLAUDE_API_KEY` |
| `OA_E2E_<AGENT>_BASE_URL` | Per-agent base URL |
| `OA_E2E_<AGENT>_MODEL` | Per-agent model |
| `OA_E2E_CONFIG` | Config file path |
| `OA_LAUNCHER_BIN` | Launcher binary to test |

Precedence is flag → environment → config file.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--agents=a,b` | every configured agent | Narrow the matrix |
| `--config=<file>` | `tests/end_to_end/agents.config.json` | Config file |
| `--app=<path>` | installed app, then `packages/launcher/out/main/index.js` | Which launcher to test |
| `--home=<dir>` | `~/.openagents-e2e/home` | Profile the run uses as `HOME` |
| `--out=<dir>` | `~/.openagents-e2e/runs` | Results and diagnostics |
| `--fresh` | off | Delete the profile first — proves the from-nothing path |
| `--attach` | off | Use a launcher already running under `--home` |
| `--reinstall` | off | Install even when the agent is already installed |
| `--keep` | off | Leave the created agents behind |
| `--json` | off | Print only the results JSON |
| `--boot-timeout` / `--install-timeout` / `--start-timeout` / `--reply-timeout` | 12 / 20 / 3 / 6 min | Patience, in minutes |

By default the run tests the **installed** launcher — the artifact users get. To
test a working copy instead, build it first and point at the output:

```bash
cd packages/launcher && npm install && npm run build
node tests/end_to_end/run.js --app=packages/launcher/out/main/index.js
```

## Warm vs fresh

The default profile is reused between runs, so installs are warm and a full
matrix takes minutes rather than hours — the right trade for a daily regression
check. `--fresh` wipes the profile so the run also covers first-launch bootstrap
(portable node + core download, then every agent install from nothing); expect
it to run for a long time and give it a generous `--install-timeout`.

## Running it daily

macOS / Linux (`crontab -e`):

```cron
30 3 * * * cd /path/to/openagents && /usr/bin/node tests/end_to_end/run.js >> ~/.openagents-e2e/cron.log 2>&1
```

Windows (Task Scheduler, daily):

```powershell
schtasks /create /tn "OpenAgents E2E" /sc daily /st 03:30 ^
  /tr "node C:\path\to\openagents\tests\end_to_end\run.js"
```

`~/.openagents-e2e/latest.json` holds the last run's machine-readable status —
`summary`, `ok`, and a per-agent breakdown — for whatever collects it.

## Reading a failure

Each agent result names the step that failed (`install`, `create`, `configure`,
`connect`, `start`, `respond`) and keeps the evidence in
`<run>/<agent>/`: `daemon.log`, `startup.log`, `install.log`, `agents.json`,
`status.json`. Secrets are redacted from everything written to disk.

Common ones:

- **`install` fails** — read `install.log`; it is the installer's own output.
- **`start` times out** — the agent never reached a running state; `daemon.log`
  says why (missing binary, bad credentials, unsupported adapter).
- **`respond` times out** — the agent started but never answered: usually a
  wrong model name or an LLM endpoint that rejects the key. `daemon.log` again.

## Testing the harness

```bash
node --test "tests/end_to_end/**/*.test.js"
```

Covers the pure logic — credential mapping, reply detection, config precedence,
the control client's error handling — so a broken harness fails in a second
instead of forty minutes into a nightly. The control server's own endpoints are
covered by `packages/launcher/src/main/control-server.test.ts`.

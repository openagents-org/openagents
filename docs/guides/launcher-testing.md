# Testing the Launcher Desktop App

How to test the OpenAgents launcher efficiently — from unit tests on your
machine to driving a real instance on a remote, SSH-only box.

## The three layers

| Layer | What it covers | Where it runs | Cost |
|---|---|---|---|
| Unit (`npm test`, vitest) | Main-process modules, pure logic | anywhere, no display | seconds |
| E2E (`npm run e2e`, Playwright) | Real app, real clicks, isolated `$HOME` | a machine with a display | minutes |
| Remote control (control server / CDP) | A **running** launcher on any machine, incl. headless | over SSH with plain `curl` | interactive |

All commands below run from `packages/launcher/`.

## Unit tests

```bash
npm test                 # vitest run, ~15s
npm run typecheck        # tsc -b
npx vitest run src/main/control-server.test.ts   # one file
```

Main-process modules are written Electron-free where possible (dependency
injection — see `control-server.ts`, `renderer-log.ts`) so they unit-test
without an Electron binary.

## E2E tests (Playwright)

```bash
npm run build            # electron-vite build → out/main/index.js
npm run e2e
```

Fixtures (`e2e/fixtures.ts`) launch `out/main/index.js` with an isolated
`$HOME`, so `~/.openagents` and the Electron profile start clean each test.
First launch bootstraps the portable Node runtime — expect minutes, not
seconds, on a cold machine.

## The control server — remote testing with curl

The launcher can expose a **localhost-only HTTP control surface** for tests
and diagnostics. It is off unless explicitly requested:

```bash
# either flag or env var; port 0 = pick any free port (logged to startup.log)
OpenAgents --headless --control-port=4599
OPENAGENTS_CONTROL_PORT=4599 OpenAgents --headless
```

Auth: every start writes a fresh random token to
`~/.openagents/control.token` (mode 0600). Send it as `Authorization: Bearer`,
`X-Control-Token`, or `?token=`:

```bash
TOKEN=$(cat ~/.openagents/control.token)
curl -s -H "Authorization: Bearer $TOKEN" localhost:4599/status | jq
```

### Endpoints

| Route | What it does |
|---|---|
| `GET /status` | version, platform, headless, uptime, `windowOpen`, `coreReady`, daemon PID, node pairings |
| `GET /agents` | agent list from the core (`[]` until the core loads) |
| `GET /logs?file=<name>&tail=N` | tails `startup`, `daemon`, `renderer` logs (default all, 200 lines) |
| `GET /screenshot` | PNG of the main window (`409` if no window — create one first) |
| `POST /pair {"code":"XXXX-XXXX"}` | redeem a node pairing code, same path as the UI. Since per-node tokens shipped, redeem returns a credential specific to this device (reused on re-pair) — assert on it in `~/.openagents/node.json` |
| `POST /window {"action":"create"\|"show"\|"hide"}` | manage the main window; `create` on a headless instance gives `/screenshot` something to capture |

### A remote smoke test in four commands

```bash
ssh box 'OPENAGENTS_CONTROL_PORT=4599 ./OpenAgents --headless & sleep 20'
ssh box 'TOKEN=$(cat ~/.openagents/control.token); curl -s -H "Authorization: Bearer $TOKEN" localhost:4599/status'
ssh box 'TOKEN=$(cat ~/.openagents/control.token); curl -s -X POST -H "Authorization: Bearer $TOKEN" -d "{\"code\":\"ABCD-EFGH\"}" localhost:4599/pair'
ssh box 'TOKEN=$(cat ~/.openagents/control.token); curl -s -H "Authorization: Bearer $TOKEN" localhost:4599/logs?tail=50'
```

## CDP — drive the real UI from another machine

When a display *is* available (local dev, RDP/VNC session, CI runner with a
desktop), set `OPENAGENTS_DEVTOOLS_PORT` to expose the Chrome DevTools
Protocol on loopback:

```bash
OPENAGENTS_DEVTOOLS_PORT=9222 OpenAgents
```

Then from your machine, tunnel and attach Playwright to the **running app** —
real window, real clicks, renderer console:

```bash
ssh -N -L 9222:127.0.0.1:9222 user@box &
```

```ts
import { chromium } from "@playwright/test"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222")
const page = browser.contexts()[0].pages()[0]
await page.screenshot({ path: "launcher.png" })
```

CDP needs a renderer to attach to, so it is complementary to the control
server: control server for headless/state/actions, CDP for UI-level driving.

## Renderer logs

The renderer's console is mirrored to `~/.openagents/renderer.log`
(rotated at ~2 MiB to `renderer.log.old`), including renderer crashes and
page-load failures. On a remote box this is the only trace of a renderer
exception — check it first when the UI "does nothing":

```bash
tail -50 ~/.openagents/renderer.log
# or through the control server:
curl -s -H "Authorization: Bearer $TOKEN" "localhost:4599/logs?file=renderer&tail=50"
```

Other useful files under `~/.openagents/`: `startup.log` (bootstrap +
updater), `daemon.log` (agent daemon + adapters), `daemon.status.json`
(per-agent state), `node.json` (workspace pairings, incl. this device's per-node tokens), `env/<type>.env`
(agent credentials), `probes.json` (last smoke-test result per agent type).

## Remote Windows: the traps

Windows over SSH has two failure modes that look like launcher bugs but
aren't:

1. **Complex PowerShell quoting across ssh mangles commands.** Don't inline;
   `scp` a `.ps1` file over and run
   `powershell -ExecutionPolicy Bypass -File script.ps1`.

2. **Processes die with the SSH session.** Anything started from an SSH
   command — including `agn up`'s "detached" daemon and the launcher itself —
   is killed when the session closes. Start long-lived processes in their own
   tree instead:

   ```powershell
   # survives SSH disconnect
   Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
     CommandLine = '"C:\path\to\OpenAgents.exe" --headless --control-port=4599'
   }
   ```

   (A Scheduled Task works too and survives reboots.)

Also note GUI processes launched from an SSH session have no desktop
(session 0), so a *visible* window may not render — prefer `--headless` plus
the control server, and `POST /window {"action":"create"}` +
`GET /screenshot` when you need pixels.

## Testing the agent layer without the GUI

The daemon and agents are fully controllable with the `agn` CLI
(`~/.openagents/nodejs/node_modules/.bin/agn` when installed by the
launcher): `agn status`, `agn logs`, `agn probe <type>` (end-to-end
smoke-test of one agent type), and — on a paired device —
`agn connect <agent> --workspace <slug>` (binds by slug, no token, no
server round-trip). The manual form `agn connect <agent> <token>` still
works but is deprecated and prints a retirement note; in scripts, silence
it with `OPENAGENTS_NO_DEPRECATION_NOTES=1`. A workspace can also drive
install/configure/start remotely via node commands — see
`packages/agent-connector/CLAUDE.md` and
`workspace/backend/app/routers/nodes.py`.

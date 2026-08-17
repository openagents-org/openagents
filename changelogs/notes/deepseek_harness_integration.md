# DeepSeek Harness (`dsh`) Agent Integration

**Date**: 2026-08-15
**Components**: `agent-connector`, `launcher`, `workspace`
**Upstream**: [`@deepseek-ai/dsh@0.1.0-rc.6`](https://github.com/deepseek-ai/deepseek-harness) (developer preview)

Adds DeepSeek's open-source agent harness as an OpenAgents agent, driven through
its headless profile as a CLI subprocess. No SDK is introduced.

## 1. Why this adapter is shaped differently

The harness's headless profile differs from every other CLI already integrated,
and three of its properties drove the design:

* **The task is a positional argv element and there is no stdin task channel.**
  Passing the workspace prompt there would publish the workspace token to
  `/proc/<pid>/cmdline` and `ps`. The adapter writes the prompt to a private
  task file (`0600`, deleted after the run) and puts only a fixed sentence in
  argv. If the file cannot be written the run **fails closed** — there is no
  fallback to argv, since that fallback would be the exposure itself.
* **Nothing is streamed.** The harness prints only the final assistant message.
  The conventional "no output for N minutes" guard would therefore kill every
  healthy long task, so the guard is a **total** 60-minute run budget instead.
  For the same reason the child is awaited on `close`, not `exit`: the whole
  answer is stdout and `exit` can fire with the tail unflushed.
* **There is no session resume.** Each message is a fresh persisted session, so
  continuity comes from a bounded workspace recap injected into the task, and
  the sessions directory needs garbage collection (7 days **or** newest-50,
  never touching profiles/settings/credentials).

## 2. Non-interactive execution without unsandboxing

The harness's own preset table pairs `approval: never` only with
`sandbox: danger-full-access`, and a headless run has no client that could
answer an approval prompt. Rather than reaching for `danger-full-access` — which
would also remove the filesystem sandbox — the adapter ships a private `--patch`
overlay that sets the two independently: `approval: never` with
`sandbox: workspace-write` intact, plus the interactive question plugin
disabled and the model override applied.

Verified against rc.6 with `--dump-config` and with a live run that created a
file and executed a shell command. `sandbox-policy` is confirmed untouched by
the patch.

## 3. Version pinning is enforced end to end

Upstream ships the harness as a developer preview whose configuration may change
between previews, so `install.supported_version` gates on **exact equality**
rather than a floor. Making that real required three fixes:

* `installer.js` `_detectVersion` was truncating `0.1.0-rc.6` to `0.1.0` (its
  regex stopped at the `-`), so a correctly installed preview failed its own
  gate. The regex now preserves the prerelease segment; agents without one are
  unaffected.
* `_evaluateCompatibility` learned `supported_version` (exact) alongside the
  existing `min_version` floor.
* The Launcher's install **and** update paths honoured neither pin: both
  rewrote a pinned command to `@latest`. For a `supported_version` entry that
  handed the user a runtime the adapter refuses to start — on a fresh install,
  with no hint about recovery. Both paths, and the update-check badge, now
  target the pinned version.

`deepseek-runtime.js` carries a prerelease-aware comparator because neither
existing one (`installer.js`'s `compareVersions`, `pi-stream.js`'s
`parseVersion`) can distinguish rc.5 from rc.6; a regression test asserts that
difference so the two are never confused again.

## 4. Node gate

The harness requires `^22.19.0 || >=24.0.0`, which **excludes 23.x**. None of
the published packages carry an `engines` field, so npm installs happily onto
an unsupported Node and the failure surfaces later as something unrelated. The
gate is therefore implemented in the adapter, and cannot reuse Pi's (a plain
`>= 22.19.0` floor, which would accept 23).

## 5. Shared helpers touched

* `formatAttachmentsForPrompt()` gained `tokenExpr` / `endpoint` options. It
  hard-coded `$TOKEN`, which expands to the empty string in a dsh child (the
  variable is `OPENAGENTS_WORKSPACE_TOKEN`) and would have made every attachment
  download silently 401. Defaults preserve the existing callers' behaviour.
* `buildDeepSeekTaskFile()` **throws** when handed anything that is not a shell
  expression, so passing the real token instead of a placeholder is a loud
  failure rather than a silent leak.
* `decision-log.js` was deliberately **not** changed: its recap guard compares
  message text, which drops an older message identical to the current one. The
  adapter filters by message id first instead, leaving the shared helper's
  behaviour untouched for cursor/cline/claude.

## 6. Scope

DeepSeek is intentionally **not** in `CORE_AGENTS`: the Install marketplace
shows it as "coming soon" (visible, not installable) until a core release
containing this adapter is published, because the marketplace flag lives in
launcher code while the adapter lives in the npm core. Enabling it is a one-line
change. The CLI path (`agn install/create/connect`) is fully functional now.

Streaming, session resume and stdin task input are upstream limitations, not
deferred work. MCP is available as a harness plugin but is mounted by neither
the base nor the headless bundle, so workspace access uses the documented HTTP
API with `curl`, as it does for OpenCode and Pi.

## 7. Tests

115 new tests (`deepseek-runtime.test.js`, `deepseek.test.js` with a scriptable
`mock-dsh.js` fixture). The adapter tests drive a real subprocess rather than a
faked `spawn`, because what they assert — what reaches argv, whether all of
stdout arrives before the promise settles, whether a process group dies — are
properties of process handling that a fake cannot demonstrate.

Full agent-connector suite: 1091 pass / 0 fail / 2 skipped (the pre-existing
Windows-only probes).

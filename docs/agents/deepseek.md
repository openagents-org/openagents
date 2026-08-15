# DeepSeek Harness (`dsh`)

DeepSeek's [open-source agent harness](https://github.com/deepseek-ai/deepseek-harness)
run as an OpenAgents agent. OpenAgents drives its **headless profile** — one
`dsh` process per workspace message — and never uses an SDK.

> **Preview release.** DeepSeek ships the harness as a developer preview and
> says compatibility can break between previews. OpenAgents therefore pins one
> exact version (`0.1.0-rc.6`) and refuses to run against any other, including
> newer ones. See [Version pinning](#version-pinning).

---

## What the adapter does

```
dsh --profile headless --patch <private patch> "Read the task file at … and complete the task described in it."
```

1. The daemon runs `preflight()` **before joining the workspace**: it resolves
   the `dsh` entry point, checks the Node version, checks the harness version
   exactly, and checks that an API key is present. A failure here means the
   agent never joins, with a precise reason instead of a poll loop that cannot
   work.
2. On the first message the adapter composes the headless profile once
   (`--dump-config`), so concurrent channels do not race to initialise it.
3. For each message it collects a bounded channel recap, writes the whole prompt
   to a private task file, and starts one `dsh` process.
4. On exit 0 the process's stdout is the reply. On any other exit the stdout is
   discarded and stderr is classified into an actionable category.

## Behaviour you should expect

| | |
|---|---|
| **No streaming** | The harness prints only the final assistant message. The workspace shows one "working…" status and then the answer — no intermediate progress. |
| **No conversation memory** | Each message is a brand-new harness session. Continuity comes from a bounded recap of the channel that OpenAgents injects into every task. |
| **One task at a time per channel** | Standard BaseAdapter queuing. |
| **60-minute ceiling** | A run is terminated after 60 minutes total. This is a **total** budget, not an idle timeout: a long, silent run is normal here and is not killed. |

## Setup

```bash
agn install deepseek
agn create my-deepseek --type deepseek
agn env deepseek --set DEEPSEEK_API_KEY=sk-...
agn up
agn connect my-deepseek <workspace-token>
```

In the Launcher, use **Configure** to set the same fields and **Test
connection** to verify the key against the endpoint the agent will actually use.

### Settings

| Variable | Required | Notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | **yes** | The agent runs with a private, empty harness home, so there is no saved `dsh` login to fall back on. |
| `DEEPSEEK_BASE_URL` | no | Gateway/proxy. Blank uses the public DeepSeek API. |
| `DEEPSEEK_MODEL` | no | e.g. `deepseek-v4-flash`. Blank uses the harness default. |
| `DSH_PERMISSION_MODE` | no | `read-only`, `workspace-write` (default) or `danger-full-access`. An invalid value is rejected, not silently defaulted. |

`LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL` are mapped to the three
`DEEPSEEK_*` variables, so a generic agent environment works unchanged.

## Isolation

Each agent instance gets its **own harness home** at
`~/.openagents/dsh-homes/<workspace>_<agent>-<hash>/`. Your personal `~/.dsh` is
never read or written, so an agent cannot inherit your profiles, patches or
saved credentials, and two agents never share sessions or settings.

Inside that home OpenAgents writes a small `--patch` overlay before every run.
It does three things the harness has no environment variable for:

- disables the interactive question plugin (a headless run has nobody to ask);
- sets tool approval to `never` **while leaving the sandbox alone**;
- applies `DEEPSEEK_MODEL`, since the model is a composition row.

### Why approval and the sandbox are set separately

The harness's own preset table pairs non-interactive approval (`approval:
never`) only with `sandbox: danger-full-access`. Taking that route to get a
working headless agent would also remove the filesystem sandbox. OpenAgents
patches the two independently instead, so `execute` mode runs **non-interactively
with writes still confined to the project directory**. `danger-full-access` is
only ever used when you set it yourself.

In OpenAgents **plan mode** the permission mode is forced to `read-only`
regardless of your setting.

## Secrets

The harness takes its task as a positional command-line argument. Putting the
workspace prompt there would publish the workspace token to `/proc/<pid>/cmdline`
and `ps`, so the adapter never does:

- the prompt is written to a private task file (`0600` on POSIX) and deleted
  when the run ends, including on failure;
- argv carries only a fixed sentence naming that file;
- the task file references the token as `$OPENAGENTS_WORKSPACE_TOKEN`, never its
  value; the value and `DEEPSEEK_API_KEY` are passed only in the child
  environment;
- logs record the flags and the task file's name and size, never its contents.

If the task file cannot be written the run **fails**. There is deliberately no
fallback to passing the prompt on the command line.

## Version pinning

`install.supported_version` in the registry is the single source of truth.

- Installing an agent installs exactly that version, and so does **Update** —
  the pin is not overridden with `@latest` the way an ordinary registry pin is.
- The adapter re-checks at run time and refuses to start on anything else,
  newer or older, and tells you the command that restores the pinned build.

To move to a new preview, update `supported_version` and the three install
commands in `sdk/src/openagents/registry/deepseek.yaml`, mirror them into
`packages/agent-connector/registry.json`, and re-verify.

## Storage

Every run creates one persisted session
(`<home>/sessions/<project>/session-<uuid>/`, roughly 20 KB) and the harness has
no resume, so the directory would grow once per message forever. The adapter
trims it after a run when no child is live: a session is removed when it is
older than 7 days **or** falls outside the newest 50. Nothing outside
`sessions/` is touched.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `DeepSeek Harness … is not supported` | An unpinned version is installed. Run the command in the message. |
| `cannot run on Node 23.x` | The harness requires `^22.19.0 \|\| >=24.0.0`. Node 23 is excluded by that range. |
| `Not configured — set DEEPSEEK_API_KEY` | No key in the agent environment. |
| `Invalid DSH_PERMISSION_MODE` | Typo. Valid values are `read-only`, `workspace-write`, `danger-full-access`. |
| `run timed out after 60 minutes` | The run hit the total ceiling. The harness reports no progress mid-run, so no partial result exists. |
| `could not stage its task file` | The private harness home is not writable. The run is not started — the prompt is never put on the command line. |

## Not supported yet

Streaming progress, session resume and stdin task input are **upstream
limitations** of the harness's headless profile, not choices. The harness also
ships an MCP client, but neither the base nor the headless bundle mounts it, so
workspace access goes through the documented HTTP API with `curl`, as it does
for OpenCode and Pi.

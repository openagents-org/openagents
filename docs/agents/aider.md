# Aider (Beta)

The adapter has offline test coverage. End-to-end verification against a live provider is pending.

Aider runs in its non-interactive scripting mode (`aider --message-file …`); the
adapter keeps a separate Aider chat history per workspace channel for follow-up
context and writes any file changes into the agent's configured working
directory. Aider is multi-provider (it routes through LiteLLM), so you pick a
**provider + model** and supply **one key**.

```bash
agn install aider                                  # install the Aider CLI (aider.chat)
agn env aider --set AIDER_PROVIDER=anthropic       # which provider the key is for
agn env aider --set AIDER_MODEL=sonnet             # a model for that provider
agn env aider --set LLM_API_KEY=<your-key>         # one key, injected per provider
agn create my-aider --type aider --path ~/code     # create an instance + working dir
agn up                                              # start the daemon
agn connect my-aider <workspace-token>              # connect Aider into a workspace
```

> **Install detection.** The official installer (`aider.chat/install.{sh,ps1}`)
> uses `uv tool install`, which places `aider` in `$XDG_BIN_HOME` →
> `$XDG_DATA_HOME/../bin` → `~/.local/bin` (and always in the uv tools venv).
> OpenAgents looks in all of these, so a fresh install is detected even when its
> directory isn't on this process's `PATH` yet. If install reports *"the Aider
> CLI could not be located"*, the underlying `uv` step usually failed to fetch a
> Python runtime (restricted network/proxy) — open a new terminal and check
> `aider --version`, or install with pip instead:
> `python -m pip install --upgrade aider-chat`.

**Provider, model & key.** `AIDER_PROVIDER` decides which provider environment
variable your `LLM_API_KEY` is injected into. It accepts `auto` (default),
`openai`, `anthropic`, `openrouter`, `requesty`, `gemini`, `deepseek`, or
`openai-compatible`:

| `AIDER_PROVIDER` | Key injected as | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | e.g. `AIDER_MODEL=sonnet` / `opus` / `claude-3-5-sonnet-20241022` |
| `openai` | `OPENAI_API_KEY` | e.g. `AIDER_MODEL=gpt-4o` |
| `openrouter` | `OPENROUTER_API_KEY` | e.g. `AIDER_MODEL=openrouter/anthropic/claude-3.5-sonnet` |
| `requesty` | `REQUESTY_API_KEY` | e.g. `AIDER_MODEL=requesty/openai/gpt-4o` |
| `gemini` | `GEMINI_API_KEY` | e.g. `AIDER_MODEL=gemini/gemini-1.5-pro` |
| `deepseek` | `DEEPSEEK_API_KEY` | e.g. `AIDER_MODEL=deepseek/deepseek-chat` |
| `openai-compatible` | `OPENAI_API_KEY` + `OPENAI_API_BASE` | **requires `LLM_BASE_URL`**; the model is normalized to `openai/<model>` |
| `auto` *(default)* | inferred from the model name | needs a model whose name identifies the provider |

Config examples:

```bash
# Anthropic with the `sonnet` alias
agn env aider --set AIDER_PROVIDER=anthropic --set AIDER_MODEL=sonnet --set LLM_API_KEY=sk-ant-…

# OpenAI
agn env aider --set AIDER_PROVIDER=openai --set AIDER_MODEL=gpt-4o --set LLM_API_KEY=sk-…

# OpenRouter
agn env aider --set AIDER_PROVIDER=openrouter \
  --set AIDER_MODEL=openrouter/anthropic/claude-3.5-sonnet --set LLM_API_KEY=sk-or-…

# OpenAI-compatible endpoint (self-hosted / relay / local)
agn env aider --set AIDER_PROVIDER=openai-compatible \
  --set AIDER_MODEL=llama3 --set LLM_BASE_URL=https://my-endpoint/v1 --set LLM_API_KEY=sk-…

# Auto mode — reuse a native key already in your shell, no LLM_API_KEY
export ANTHROPIC_API_KEY=sk-ant-…
agn env aider --set AIDER_PROVIDER=auto --set AIDER_MODEL=sonnet
```

Rules:

- **`AIDER_PROVIDER` decides where the generic `LLM_API_KEY` goes.** When it is
  explicit (not `auto`) it wins outright — the model name never silently
  overrides it (an obviously-conflicting model, e.g. `anthropic` + `openai/…`,
  is rejected with a clear error rather than guessed).
- **`AIDER_MODEL` may be left blank**, *but* if you set `LLM_API_KEY`, the
  provider must be determinable — either via `AIDER_PROVIDER` or a model name
  that identifies it. A generic key with no determinable provider returns a
  clear configuration error on the first task (it is **never** silently sent to
  OpenAI).
- **`LLM_BASE_URL` is only for `openai-compatible`** services (it becomes
  `OPENAI_API_BASE`); leave it blank for hosted providers.
- **No `LLM_API_KEY`?** Nothing is overridden — Aider uses whatever native
  provider keys are in your shell / project `.env` / `.aider.conf.yml`.
  `AIDER_PROVIDER=auto` with a blank model is a valid (fully automatic) config.
- **The adapter passes credentials to the Aider process through its environment.** Installing the CLI does **not** configure auth, and creating an
  agent does **not** validate the key; a wrong key (or undeterminable provider)
  surfaces as a clear error on the **first workspace message**.

**File changes & Git — important.** Aider auto-commits by default; OpenAgents
does **not**. The adapter runs Aider with `--no-auto-commits --no-dirty-commits`
so it edits your working-tree files but never creates commits and never commits
your pre-existing changes. It also passes `--no-gitignore` (your tracked
`.gitignore` is left untouched) and adds `.aider*` to `.git/info/exclude` (a
local-only file that is never committed) so Aider's cache stays out of
`git status`. To opt **in** to Aider's automatic commits, set
`AIDER_AUTO_COMMITS=true`. Aider works in both Git repos and non-Git
directories. Per-channel chat history is stored under
`~/.openagents/sessions/aider/` (never inside your project), so follow-up
messages in the same channel resume that conversation, while a different channel
starts fresh.

**Verifying end to end.** With a real model key configured: create + connect the
agent, send a message asking it to change a file in the working directory,
confirm the file changed and that `git status` shows no surprise commit, send a
second message in the same channel to confirm context is remembered, and use the
workspace **Stop** control to cancel a running task.

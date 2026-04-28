# Agent E2E Smoke Test

CLI-based agent lifecycle smoke test for OpenAgents Workspace.

Validates the full agent lifecycle through the `agn` CLI: install, configure, create, connect, message, reply, update, and cleanup.

## Test Flow

1. Install agent runtime (`agn install hermes`)
2. Configure LLM credentials (`~/.hermes/.env`)
3. Create agent (`agn create ...`)
4. Connect to workspace (`agn connect ...`)
5. Start daemon (`agn up --foreground`)
6. Start agent (`agn start ...`)
7. Post a workspace message via `POST /v1/events`
8. Poll for agent reply via `GET /v1/events`
9. Assert reply correctness
10. Run `agn update`
11. Post a second message and verify reply after update
12. Cleanup: stop, disconnect, remove, down

## Local Run

```bash
AGENT_TYPE=hermes \
LLM_API_KEY=sk-your-key-here \
LLM_BASE_URL=https://yinli.one/v1 \
LLM_MODEL=gemini-2.5-flash \
E2E_WS_TOKEN=your-workspace-token \
E2E_WS_SLUG=your-workspace-slug \
node tests/e2e/agent-smoke.js
```

Logs are written to `.e2e-logs/` (agent.log, e2e-run.log, env-summary.log).

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_TYPE` | Yes | Agent type to test (default: `hermes`) |
| `LLM_API_KEY` | Yes | LLM provider API key |
| `E2E_WS_TOKEN` | Yes | Workspace auth token |
| `E2E_WS_SLUG` | Yes | Workspace slug or ID |
| `LLM_BASE_URL` | No | LLM base URL (see note below) |
| `LLM_MODEL` | No | LLM model name (see note below) |
| `WORKSPACE_API_BASE_URL` | No | Defaults to `https://workspace-endpoint.openagents.org` |

## GitHub Secrets

Configure these in your repository settings:

- `LLM_API_KEY` — LLM provider API key
- `LLM_BASE_URL` — LLM base URL (optional)
- `LLM_MODEL` — LLM model name (optional)
- `E2E_WS_TOKEN` — Workspace auth token
- `E2E_WS_SLUG` — Workspace slug

## Supported Agent Types

- **hermes** — Hermes agent via `agn` CLI

## Hermes LLM Configuration

Hermes manages its own credentials independently — it does **not** use the `agn env` system.

The test script configures Hermes in two ways:

1. Writes `OPENAI_API_KEY` to `~/.hermes/.env`
2. If `LLM_BASE_URL` and `LLM_MODEL` are both set, patches `~/.hermes/config.yaml` to use a custom endpoint:

```yaml
model:
  default: <LLM_MODEL>
  provider: custom
  base_url: <LLM_BASE_URL>
  api_key: <LLM_API_KEY>
```

This allows CI to configure Hermes non-interactively (no need for `hermes model`).

If `LLM_BASE_URL` or `LLM_MODEL` is not set, the script skips the config.yaml patch and Hermes uses its existing model configuration.

## Adding a New Agent Type

1. Add an entry to the `AGENTS` registry in `tests/e2e/agent-smoke.js`:

```js
const AGENTS = {
  hermes: { ... },
  newagent: {
    type: "newagent",
    install: ["agn", "install", "newagent"],
    create: (name) => ["agn", "create", name, "--type", "newagent"],
    update: ["agn", "update"],
  },
};
```

2. Add a `configureLLM` branch for the new type:
   - If the agent uses `agn env`, call `runCommand(["agn", "env", type, "--set", ...])`.
   - If the agent manages its own credentials (like Hermes), write the config files directly.

3. Run with `AGENT_TYPE=newagent`.

## Security

- Never commit API keys or tokens to the repository.
- All secrets must be stored in GitHub Secrets or local environment variables.
- The test script sanitizes all sensitive values before writing to logs.
- `.e2e-logs/` should not be committed — add it to `.gitignore` if needed.

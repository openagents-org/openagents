# Workspace Model Runtime Sync Design

## Goal

Make a model selected from a Workspace agent profile control the model used by
the next JavaScript connector invocation, instead of only updating Workspace
metadata or the model name injected into prompts.

Python SDK adapters are explicitly out of scope.

## Current failure

The Workspace backend persists `WorkspaceMember.model` and emits a
`model.set` control event. The JavaScript `BaseAdapter` can store that value as
`workspaceModel`, but adapter control overrides can swallow the shared action,
and most runners continue reading a constructor-time environment value when
they build their command or API request.

Hermes has both failures. Its control override does not delegate to the base
handler, and `_buildHermesCmd` does not include a runtime model override. A
restart only makes the prompt claim the Workspace model is active while the
Hermes process still reads its native default from `config.yaml`.

## Scope

The implementation covers JavaScript connector agent types whose Workspace
catalog exposes model choices:

- Claude
- Codex
- Cursor
- OpenCode
- Hermes
- Kimi
- Copilot
- Goose
- Aider
- Cline
- Gemini
- Antigravity
- mini-swe-agent
- Pi
- DeepSeek

Newer adapters that already consume `workspaceModel` remain covered by shared
contract tests where practical. Cloud agents retain their server-side model
path. Python adapters and their registries are not changed.

## Design

### Shared control handling

`BaseAdapter._pollControl` handles `model.set` alongside `set_mode`, before
dispatching adapter-specific actions. This makes the model update independent
of whether a subclass remembers to call `super._onControlAction`.

The base adapter exposes a small model-resolution API:

- `effectiveModel(...fallbacks)` returns the trimmed Workspace override when
  present, otherwise the first configured fallback.
- `modelLabel()` uses that same resolution path, so reported identity and
  execution use one source of truth.

Clearing the Workspace model sets the override to `null`, restoring the
adapter's existing environment or native default.

### Runtime application

Every covered adapter reads `effectiveModel` at the point where it creates the
next command, request payload, or runtime configuration. Constructor-time
model fields remain fallbacks only.

- One-shot CLI adapters add the selected model to their next command.
- Direct API adapters put the selected model in the next request payload.
- Persistent adapters compare the effective model with the model used to
  spawn the current process and respawn while preserving resumable session
  state.
- Adapters whose runtime configuration is created per request pass the
  effective model into that configuration.

No Workspace profile change writes a type-level environment file or a shared
native configuration file. The override is scoped to the connected agent
instance.

### Hermes provider routing

Hermes model entries in the Workspace catalog are Nous Portal entries. The
Hermes adapter therefore applies a Workspace-selected catalog model using
Hermes' per-run flags:

```text
hermes chat --provider nous --model <model-id> ...
```

The flags do not mutate `~/.hermes/config.yaml`. Clearing the Workspace
override omits both flags and returns to Hermes' configured provider and model.
If the device has not authenticated Nous Portal, Hermes must return its real
authentication error; it must never silently fall back to the previous custom
model.

Catalog metadata records the runtime provider for explicit model lists so the
provider is data rather than inferred from the display label. The selected
provider is included in `model.set` and agent discovery without changing the
meaning of the existing model string. Older launchers ignore the extra field.

### UI behavior

The picker continues to save the model through the existing member endpoint.
Its success message means the selection was persisted, while actual runtime
failures are surfaced by the adapter on the next reply. Model choices carry
their declared runtime provider; a provider-specific choice is not presented
as a generic endpoint model.

This change does not add a synchronous device acknowledgement protocol. Such
an acknowledgement would require a separate command lifecycle and is outside
this bug fix.

## Data flow

1. The profile picker submits the selected model and its catalog provider.
2. The backend validates and persists both values.
3. Discovery returns both values for adapter startup.
4. `model.set` carries both values for a running adapter.
5. `BaseAdapter` updates the in-memory override centrally.
6. The next adapter invocation resolves the effective model and provider.
7. The runner puts those values into its real CLI arguments, environment, or
   API payload.

## Compatibility

- Existing member rows with only `model` remain valid; provider is nullable.
- Existing API clients can continue sending only `model`.
- Clearing `model` also clears its provider.
- Adapters that do not need an explicit provider ignore it.
- The backend migration is additive and nullable.
- No new package dependency is introduced.

## Testing

Tests are written before implementation and cover:

- `model.set` reaches shared handling even when an adapter override does not
  call `super`.
- clearing a model restores adapter fallback behavior.
- Hermes emits `--provider nous --model <id>` and removes both when cleared.
- each catalog-backed JavaScript adapter uses the Workspace model in the next
  executable command, runtime config, or HTTP payload.
- persistent adapters respawn when their effective model changes.
- backend PATCH, event payload, and discovery preserve nullable provider data.
- frontend submits the provider associated with the selected catalog entry.
- focused connector, backend, and frontend suites pass.

## Repository constraints

- Work only on `bugfix/workspace-model-runtime-sync`.
- Do not push.
- Commit messages contain no colon.
- Commit author and committer names must not contain `codex` or `ChatGPT`.

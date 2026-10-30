# Troubleshooting agent connection errors

This guide maps the errors people hit most often when connecting a local agent
to an OpenAgents Workspace (HTTP 401, 402, 400 "model not found", `CLI exited 1`
and others) to their cause and fix.

Errors show up in three places:

- **In the chat**, as the agent's reply (for example
  `HTTP 401: Invalid token (request id: …)`).
- **On the agent's card or Configure page**, as a red line under the agent or
  in the *Smoke test* box.
- **On the device**, in `agn logs <agent>` or the launcher's log view.

The text after the status code is the part that matters. It is what the model
provider, or the agent's CLI, actually said.

## Quick lookup

| You see | Usually means | First thing to try |
|---|---|---|
| `HTTP 401: Invalid token (request id: …)` | The OpenAgents credits key (`api-gateway.openagents.org`) was rejected, or the CLI is still sending an old key | [401 Invalid token](#http-401-invalid-token-request-id) |
| `HTTP 401: {"detail":"Invalid API key"}`, `Incorrect API key`, `authentication_error` | The provider rejected the API key | [401 Invalid API key](#http-401-invalid-api-key--403) |
| `401 Missing Authentication header` | The CLI sent no key at all | [401 Invalid API key](#http-401-invalid-api-key--403) |
| `HTTP 402`, `insufficient credits`, `quota exceeded`, `余额不足` | The key works but the account has no credit left | [402 out of credit](#http-402--out-of-credit-or-quota) |
| `HTTP 429`, `rate limit`, `overloaded` | The provider is throttling | [429 rate limited](#http-429--rate-limited) |
| `HTTP 400 … 模型不存在: <model>`, `model_not_found`, `unknown model` | The selected model is not served by this key's endpoint | [400 model not found](#http-400--model-not-found) |
| `Error processing message: CLI exited 1: …` | The agent's CLI crashed. The reason follows the colon | [CLI exited 1](#cli-exited-1) |
| `… session file locked (timeout 10000ms): pid=… *.jsonl.lock` | Another OpenClaw run still holds the channel's session | [Session file locked](#openclaw-session-file-locked) |
| `Error: Agent '<name>' already exists` | The device already has an agent with that name | [Agent already exists](#agent-name-already-exists) |
| **Needs login** badge, "This agent isn't logged in on the device" | No API key and no CLI sign-in on that device | [Needs login](#needs-login) |
| Agent stuck on *Spinning up…*, or `workspace credentials missing` | The device's workspace pairing is missing or revoked | [Workspace connection errors](#workspace-connection-errors) |
| `ENOTFOUND`, `ECONNREFUSED`, `fetch failed`, certificate errors | The device cannot reach the provider | [Network errors](#network-errors) |

## Before anything else

1. **Update the launcher.** Many of the errors below were fixed in the connector.
   Run `agn update`, or update from the launcher, then `agn version`.
   The OpenClaw/Hermes key fix described below needs 0.2.198 or later.
2. **Re-run the smoke test.** Open the agent's *Configure* page and click
   **Re-test**, or run `agn probe <agent>` on the device. The smoke test
   classifies the failure and prints the next step.
3. **Test the key on its own.** `agn test-llm <type>` (for example
   `agn test-llm openclaw`) calls the model endpoint directly with the saved key
   and model, without the agent's CLI. If this passes and the agent still
   fails, the problem is in the CLI's own config, not the key.

## HTTP 401: Invalid token (request id: …)

```
HTTP 401: Invalid token (request id: 20261023123755319635711826 8d9d6j552FKgW)
```

The `request id` format comes from the OpenAgents API gateway, the endpoint
behind **OpenAgents credits** / **Use free credits**. The gateway did not
accept the key it received.

Causes, most common first:

1. **The CLI is still using an older key.** Before launcher 0.2.198, adding an
   OpenClaw agent saved the key in OpenAgents but did not write it into
   OpenClaw's own config. OpenClaw kept sending a stale credential it had stored
   earlier, so the smoke test passed and the real run failed with 401.
2. **The key was revoked, deleted or has expired.** For example, the promo key
   was regenerated in the workspace after this agent was set up.
3. **The key was pasted incompletely** (missing characters, a trailing space).

Fix:

1. Update the launcher to 0.2.198 or later (`agn update`).
2. Open the agent's **Edit** / *Configure* page. Under **Model & credentials**,
   pick the current OpenAgents credits key again, or click **Use free
   credits**. Save so the key is written to the agent again.
3. For OpenClaw, if the error persists, run `openclaw doctor --fix` on the
   device, then restart the agent (`agn stop <agent>` then `agn start <agent>`,
   or **Stop** then **Start** on the card).
4. Confirm with `agn test-llm openclaw` and **Re-test**.

## HTTP 401 Invalid API key / 403

```
HTTP 401: {"detail":"Invalid API key"}
401 Incorrect API key provided
401 Missing Authentication header
```

The model provider rejected the key, or no key was sent at all. The *Smoke
test* box says this directly: "*&lt;Agent&gt;*'s API key was rejected by the
provider".

Fix:

1. Check the key belongs to the provider the agent is pointed at. For example,
   an OpenAI key will not work against the OpenAgents gateway, and the reverse.
   If you set a custom base URL, the key must be for that base URL.
2. Replace the key under **Model & credentials**, or in the launcher
   (Agents → *type* → Configure). Save.
3. `Missing Authentication header` from **Hermes** means the key never reached
   Hermes's config, so it fell back to OpenRouter with no key. Update to 0.2.198
   or later and save the agent again.
4. For agents that sign in through their own CLI (Claude Code, Codex, Kimi,
   Gemini and others), a 401 usually means the sign-in has expired. Run the CLI's
   login command on the device (for example `claude`, `codex login`,
   `kimi login`), then **Re-test**.
5. Verify with `agn test-llm <type>`.

## HTTP 402 / out of credit or quota

```
HTTP 402 Payment Required
insufficient_quota / You exceeded your current quota / credit balance is too low / 余额不足
```

The key is valid, but the account behind it has no credit left. Some relays
return 403 with a quota message instead of 402. Treat it the same way: this is
not a bad key, so replacing the key with the same account's key will not help.

Fix:

- For OpenAgents credits, check the remaining balance shown under **Model &
  credentials** ("$… left on your promo key"). If it is exhausted, switch to a
  different key.
- For a provider key, add credit or raise the quota in the provider's console,
  or switch the agent to another key or a cheaper model.

## HTTP 429 / rate limited

The provider is throttling requests (`429`, `rate limit`, `overloaded`, `529`).
Wait a few minutes and try again. If it happens constantly, the account's rate
tier is too low for the workload. Use a different key or model.

## HTTP 400 / model not found

```
HTTP 400: {"error":{"message":"模型不存在: gpt-5.6-sol","type":"error","code":"invalid_request"}}
```

The key works, but the endpoint does not serve the model the agent asked for.
This happens when a model name was typed by hand, when the model was retired,
or when a key was switched to one that serves a different set of models.

Fix:

1. Open the agent's **Edit** page and pick a model from the **Model** list. With
   OpenAgents credits the list shows only the models that key serves ("N models
   available to this key").
2. Click **Test model** before saving.
3. If the page says "The provider rejected this API key", or the Model list stays
   empty, fix the key first (see the 401 sections), then reopen the page.

After choosing a key, pick a model in **Choose a model…** before clicking
**Add agent**. The agent cannot be added without one.

## CLI exited 1

```
Error processing message: CLI exited 1: <what the CLI printed>
```

The agent's own CLI (OpenClaw, Codex, Hermes and others) exited with an error
while handling the message. `exit 1` only means "failed". The cause is the text
after the colon, so look that text up in this guide:

- It contains `401`, `Invalid token` or `Invalid API key`: see the 401 sections.
- It contains `quota`, `402` or `429`: see the credit and rate-limit sections.
- It contains `model`: see [model not found](#http-400--model-not-found).
- It contains `session file locked`: see the next section.
- It contains `requires legacy credential migration; run openclaw doctor --fix`:
  run `openclaw doctor --fix` on the device and restart the agent.

If the text is cut off, run `agn logs <agent> --lines 200` on the device for the
full output. To reproduce outside OpenAgents, run the agent's CLI once in a
terminal on the device. A first-run consent or login prompt there will also
block every OpenAgents run until it is answered.

## OpenClaw session file locked

```
CLI exited 1: … error="Error: session file locked (timeout 10000ms): pid=5988
C:\Users\<you>\.openclaw\agents\main\sessions\openagents-<id>.jsonl.lock"
FailoverError: session file locked …
```

OpenClaw keeps one session file per workspace channel and locks it while a run
is in progress. A second run could not get the lock within 10 seconds, because
an earlier run (the `pid` shown) is still working on that channel or crashed
without releasing it.

Fix:

1. Wait for the current reply to finish, then send the message again. Sending
   several messages in quick succession to the same OpenClaw agent can trigger
   this.
2. If it keeps failing, stop the agent (**Stop**, or `agn stop <agent>`) and check
   whether the process in `pid=…` is still running:
   - Windows: `tasklist /FI "PID eq 5988"`, then end it with
     `taskkill /PID 5988 /F`
   - macOS/Linux: `ps -p 5988`, then end it with `kill 5988`
3. If no such process exists, delete the `.lock` file named in the error. Leave
   the `.jsonl` file next to it, which holds the conversation.
4. Start the agent again.

## Agent name already exists

```
Error: Agent 'deepseek' already exists
```

Agent names must be unique on a device. This device already has an agent with
that name, possibly one you removed from the workspace but not from the device.

Fix: choose a different name (for example `deepseek1020`), or remove the old
agent first with `agn remove deepseek` (or delete it in the launcher). Then add
the agent again. Delete the failed card from the device list.

## Needs login

A **Needs login** badge and the message "This agent isn't logged in on the
device" mean the agent has neither an API key in OpenAgents nor a signed-in CLI
on that device. It cannot answer until one of them is set up.

Fix, either:

- Under **Model & credentials**, choose a key (or **New key**), or click **Use
  free credits** to use OpenAgents credits. Then pick a model. Or
- Sign in with the agent's CLI on the device (for example `kimi login`), then
  **Re-test**.

"Log in on the device — or configure later" is not a working configuration on
its own. It just means you will sign in on the device yourself.

## Workspace connection errors

These come from the connection between the device and the workspace, not from
the model provider:

- **The agent stays on *Spinning up…*** after you re-paired the device, or the
  logs show repeated 401s on join/poll/heartbeat. Re-pairing replaces the
  device's workspace token and revokes the old one. Connector versions that
  watch for this restart the agent automatically within about 15 seconds. On
  older versions, update the launcher, or run `agn restart`.
- **`workspace credentials missing — re-pair this device with the workspace`**:
  the device has no pairing for that workspace. Pair it again from the
  workspace's **Connect Agent** page (`agn device connect <code>`).
- **The device shows offline**: check the daemon is running with `agn status`,
  and start it with `agn up`.

## Network errors

`ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, `fetch failed`, `socket hang up` or
`self-signed certificate` mean the device could not reach the provider. Check
the device's network, proxy settings and firewall. On a corporate network, the
proxy may need to be set for the agent's CLI as well. Then run
`agn test-llm <type>` again.

## Still stuck

When you report the problem, include:

- The full error text, including any `request id`.
- The agent type and name, the device OS, and the output of `agn version`.
- The output of `agn probe <agent>` and `agn logs <agent> --lines 200`.

Remove API keys from anything you paste. The launcher redacts keys in its own
output, but the CLIs' raw logs may not.

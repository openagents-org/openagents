"use strict"

/**
 * One agent, end to end: install → create → configure → connect → start → ask
 * it something and read the answer back.
 *
 * Every step goes through the launcher's control server, which is the same
 * AgentManager the UI calls over IPC — so a green run means the desktop path
 * works on this machine today, not that some parallel CLI does.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")

const { sleep, ensureDir, formatDuration } = require("./util")
const { removeMember } = require("./workspace")

const RUNNING_STATES = /^(running|online|idle|active)$/i
/** Status/thinking chatter the agent posts before its real answer. */
const NON_ANSWER_TYPES = new Set(["thinking", "status", "tool", "tool_call"])

/**
 * How an adapter reports that it could not answer.
 *
 * These arrive as ordinary chat messages — `sendError` in the core's adapter
 * base sets no distinguishing message_type — so the text is the only signal.
 * Catching them matters more than it looks: a substring check for the expected
 * answer can PASS on an error, which is how "CLI exited 1: ... requested=
 * custom/deepseek-4-flash" once counted as the answer to "what is 2+2".
 * Prefixes collected from the adapters' own sendError call sites.
 */
const AGENT_ERRORS = [
  /^error(:| processing message)/i,
  /^agent error:/i,
  /^configuration error:/i,
  /^failed to (run|start)\b/i,
  /^working directory does not exist:/i,
  /^the agent hit an error/i,
  /\bCLI not found\b/i,
  /became unresponsive and was res/i,
  /timed out before producing a resp/i,
  /^⚠️/,
]

/** The agent's own error text, or null when the message is a real answer. */
function agentError(text) {
  const body = String(text || "").trim()
  return AGENT_ERRORS.some((re) => re.test(body)) ? body : null
}

/**
 * Does the reply contain the expected answer as a TOKEN, rather than as a
 * fragment of a longer word?
 *
 * A plain `includes("4")` matched the "4" inside "deepseek-4-flash" and so
 * passed an agent whose only message was a failure naming that model.
 * Excluding hyphen and underscore neighbours — the characters that hold model
 * and package names together — separates that from a real answer, including
 * one that arrives after a warning banner, which is how Hermes answers.
 */
function containsAnswer(reply, expected) {
  const needle = String(expected == null ? "" : expected).trim()
  if (!needle) return true
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^\\w-])${escaped}([^\\w-]|$)`, "i").test(String(reply))
}

/** A short, unique, filesystem- and workspace-safe instance name. */
function instanceName(type) {
  const tag =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "mac"
        : "lx"
  return `e2e-${type}-${tag}-${Date.now().toString(36)}`
}

/**
 * Map this agent's credentials onto the env vars the Configure dialog asks for.
 *
 * The field list comes from the launcher itself (GET /agents/env-fields), so a
 * registry change lands in the test without an edit here — we only have to know
 * the three shapes a field can have. Explicit `env` entries win: they are the
 * escape hatch for an agent whose variables don't follow the convention.
 */
function buildEnv(fields, agent) {
  const env = {}
  for (const field of fields) {
    const name = field && field.name
    if (!name) continue
    if (/_API_KEY$/.test(name) && agent.apiKey) env[name] = agent.apiKey
    else if (/_BASE_URL$/.test(name) && agent.baseUrl) env[name] = agent.baseUrl
    else if (/_MODEL$/.test(name) && agent.model) env[name] = agent.model
    else if (field.default) env[name] = String(field.default)
  }
  return { ...env, ...agent.env }
}

/** Required fields the credentials can't fill — the reason to skip, not fail. */
function missingRequired(fields, env) {
  return fields
    .filter((f) => f && f.required && !String(env[f.name] || "").trim())
    .map((f) => f.name)
}

/**
 * Config an agent reads from disk rather than the environment (Hermes keeps its
 * key in ~/.hermes/.env, the way `hermes setup` writes it). Declared per agent
 * in the config file so this stays data, not a growing if-chain.
 */
function writeConfigFiles(agent, homeDir) {
  const written = []
  for (const [rawPath, rawBody] of Object.entries(agent.files || {})) {
    const target = path.resolve(
      rawPath.startsWith("~/") ? path.join(homeDir, rawPath.slice(2)) : rawPath,
    )
    const body = String(rawBody)
      .replace(/\$\{apiKey\}/g, agent.apiKey)
      .replace(/\$\{baseUrl\}/g, agent.baseUrl)
      .replace(/\$\{model\}/g, agent.model)
    ensureDir(path.dirname(target))
    fs.writeFileSync(target, body)
    written.push(target)
  }
  return written
}

function isAnswer(message, agentName) {
  if (!message) return false
  if (message.senderType === "human") return false
  if (NON_ANSWER_TYPES.has(String(message.messageType || "").toLowerCase()))
    return false
  const text = String(message.content || "").trim()
  if (!text || text.toLowerCase() === "thinking...") return false
  // A workspace can hold other agents; only this run's agent counts.
  const sender = String(message.senderName || "")
  return (
    sender === agentName ||
    sender.includes(agentName) ||
    message.senderType === "agent"
  )
}

class StepRecorder {
  constructor(log) {
    this.steps = []
    this.log = log
  }

  async run(name, fn) {
    const startedAt = Date.now()
    this.log(`  · ${name}`)
    try {
      const detail = await fn()
      const step = {
        name,
        status: "ok",
        durationMs: Date.now() - startedAt,
        detail: detail || null,
      }
      this.steps.push(step)
      this.log(
        `    ✓ ${name} (${formatDuration(step.durationMs)})${detail ? ` — ${detail}` : ""}`,
      )
      return detail
    } catch (err) {
      this.steps.push({
        name,
        status: "fail",
        durationMs: Date.now() - startedAt,
        detail: err.message,
      })
      throw err
    }
  }

  skipped(name, reason) {
    this.steps.push({ name, status: "skipped", durationMs: 0, detail: reason })
    this.log(`    – ${name} skipped — ${reason}`)
  }
}

/** Install the type if it isn't there, polling the background install job. */
async function ensureInstalled({
  control,
  type,
  timeoutMs,
  pollMs,
  reinstall,
  step,
  log,
}) {
  // An unreachable marketplace must not stop the run: installing is idempotent,
  // so "we could not tell" resolves to "install it".
  const catalog = await control.catalog().catch((err) => {
    log(`    ! could not read the catalog (${err.message}) — installing anyway`)
    return null
  })
  const entry =
    catalog && (catalog.catalog || []).find((c) => c && c.name === type)
  if (entry && entry.installed && !reinstall) {
    step.skipped("install", `${type} already installed`)
    return
  }
  await step.run("install", async () => {
    await control.startInstall(type)
    const job = await control.waitFor(
      async () => {
        const state = await control.installStatus(type)
        return state.state === "running" ? null : state
      },
      {
        timeoutMs,
        intervalMs: pollMs,
        label: `the ${type} installer to finish`,
        describe: () => "still running",
      },
    )
    if (job.state !== "done") {
      const tail = String(job.log || "")
        .split("\n")
        .slice(-12)
        .join("\n")
      throw new Error(`installer failed: ${job.error || "unknown"}\n${tail}`)
    }
    return formatDuration(job.durationSeconds * 1000)
  })
}

async function runAgent({
  control,
  config,
  agent,
  workspace,
  log,
  outDir,
  redact,
}) {
  const startedAt = Date.now()
  const step = new StepRecorder(log)
  const name = instanceName(agent.type)
  const result = {
    type: agent.type,
    instance: name,
    status: "fail",
    reason: null,
    reply: null,
    steps: step.steps,
    durationMs: 0,
  }

  if (agent.skip) {
    result.status = "skip"
    result.reason = agent.skip
    result.durationMs = Date.now() - startedAt
    log(`  – skipped: ${agent.skip}`)
    return result
  }

  try {
    await ensureInstalled({
      control,
      type: agent.type,
      timeoutMs: config.timeouts.install,
      pollMs: config.timeouts.poll,
      reinstall: config.reinstall,
      step,
      log,
    })

    // The working directory is the agent's spawn cwd; a missing one makes the
    // daemon's spawn fail with an error that reads like a broken agent.
    const workdir = ensureDir(path.join(config.homeDir, "e2e-work", name))
    await step.run("create", async () => {
      await control.createAgent(name, agent.type, workdir)
      const agents = await control.agents()
      if (!agents.some((a) => a.name === name)) {
        throw new Error("the runtime did not persist the agent")
      }
      return name
    })

    const fields = await control.envFields(agent.type)
    const env = buildEnv(fields, agent)
    const missing = missingRequired(fields, env)
    if (missing.length) {
      result.status = "skip"
      result.reason = `no credential for ${missing.join(", ")}`
      step.skipped("configure", result.reason)
      await cleanup({ control, config, name, workspace, step, log })
      result.durationMs = Date.now() - startedAt
      return result
    }

    await step.run("configure", async () => {
      const files = writeConfigFiles(agent, config.homeDir)
      if (Object.keys(env).length) await control.saveInstanceEnv(name, env)
      const vars = Object.keys(env).join(", ") || "no env fields"
      return files.length ? `${vars} (+${files.length} config file(s))` : vars
    })

    await step.run("connect", async () => {
      await control.connect(name, workspace.slug)
      return workspace.slug
    })

    await step.run("start", async () => {
      await control.start(name)
      // Remembered outside the probe so a timeout can say what the agent was
      // stuck AT — "state=error: no binary" beats "it never started".
      let seen = null
      const row = await control.waitFor(
        async () => {
          const agents = await control.agents()
          seen = agents.find((a) => a.name === name) || null
          return seen && RUNNING_STATES.test(String(seen.state || ""))
            ? seen
            : null
        },
        {
          timeoutMs: config.timeouts.start,
          intervalMs: 3_000,
          label: `${name} to reach a running state`,
          describe: () =>
            seen
              ? `state=${seen.state}${seen.lastError ? ` — ${seen.lastError}` : ""}`
              : "the agent is not in the daemon's list",
        },
      )
      return `state=${row.state}`
    })

    await step.run("respond", async () => {
      const channel = name
      const before = new Set(
        (await control.chatMessages(workspace.id, channel, 100)).map(
          (m) => m.messageId,
        ),
      )
      await sleep(config.timeouts.settle)
      await control.sendChat(workspace.id, channel, name, agent.prompt)

      const answer = await control.waitFor(
        async () => {
          const messages = await control.chatMessages(
            workspace.id,
            channel,
            100,
          )
          return (
            messages.find(
              (m) => !before.has(m.messageId) && isAnswer(m, name),
            ) || null
          )
        },
        {
          timeoutMs: config.timeouts.reply,
          intervalMs: 5_000,
          label: `${name} to answer`,
          describe: () => "no agent message in the channel yet",
        },
      )
      result.reply = String(answer.content || "").slice(0, 400)
      if (!containsAnswer(answer.content, agent.expect)) {
        // Only now ask whether this was the adapter reporting a failure: a real
        // answer can arrive behind a warning banner, and checking the error
        // shape first would fail it.
        const failed = agentError(answer.content)
        throw new Error(
          failed
            ? `the agent reported an error: ${failed.slice(0, 300)}`
            : `answer did not contain "${agent.expect}": ${JSON.stringify(
                result.reply.slice(0, 200),
              )}`,
        )
      }
      return JSON.stringify(result.reply.slice(0, 80))
    })

    result.status = "pass"
  } catch (err) {
    result.reason = err.message
    log(`    ✗ ${err.message.split("\n")[0]}`)
    await collectDiagnostics({ control, agent, name, outDir, redact, log })
  }

  await cleanup({ control, config, name, workspace, step, log })
  result.durationMs = Date.now() - startedAt
  return result
}

/**
 * Leave both sides as we found them so tomorrow's run starts from the same
 * state: the agent goes from the daemon AND its membership row goes from the
 * workspace. Skipping the second half leaves a dead member behind every day.
 */
async function cleanup({ control, config, name, workspace, step, log }) {
  if (config.keep) {
    step.skipped("cleanup", "--keep")
    return
  }
  try {
    await control.stop(name)
    // The daemon stops asynchronously; removing under it leaves a stray process.
    await sleep(Math.min(2_000, config.timeouts.poll))
    await control.remove(name)
  } catch (err) {
    // A leftover agent is worth knowing about but never turns a green run red.
    log(`    ! cleanup of ${name} failed: ${err.message}`)
  }
  if (config.workspace && !(await removeMember(config.workspace, name))) {
    log(`    ! ${name} is still listed as a workspace member`)
  }
}

/** Everything needed to tell WHY a cell failed, without a second run. */
async function collectDiagnostics({
  control,
  agent,
  name,
  outDir,
  redact,
  log,
}) {
  const dir = ensureDir(path.join(outDir, agent.type))
  const write = (file, body) => {
    try {
      fs.writeFileSync(path.join(dir, file), redact(String(body || "")))
    } catch {
      /* diagnostics are best-effort */
    }
  }
  try {
    write("daemon.log", await control.logs("daemon", 400))
    write("startup.log", await control.logs("startup", 200))
    write("agents.json", JSON.stringify(await control.agents(), null, 2))
    write("status.json", JSON.stringify(await control.status(), null, 2))
    const job = await control.installStatus(agent.type).catch(() => null)
    if (job && job.log) write("install.log", job.log)
    log(`    → diagnostics in ${dir}`)
  } catch (err) {
    log(`    ! could not collect diagnostics: ${err.message}`)
  }
}

module.exports = {
  runAgent,
  buildEnv,
  missingRequired,
  isAnswer,
  agentError,
  containsAnswer,
  instanceName,
}

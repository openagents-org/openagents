"use strict"

/**
 * Run configuration: CLI flags, then environment, then the config file.
 *
 * The config file IS the agent matrix — an agent is tested because it has an
 * entry with credentials, and skipped (with a reason in the report) when it
 * doesn't. That keeps "which agents can we test today" in one reviewable file
 * per machine instead of spread across a dozen environment variables.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")

const DEFAULT_API_BASE = "https://workspace-endpoint.openagents.org"
const DEFAULT_PROMPT = "What is 2+2? Reply with just the number."
const DEFAULT_EXPECT = "4"

const DEFAULTS = {
  bootTimeoutMin: 12,
  installTimeoutMin: 20,
  startTimeoutMin: 3,
  replyTimeoutMin: 6,
  settleSec: 15,
  pollSec: 10,
}

function parseArgs(argv) {
  const flags = {}
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue
    const [key, ...rest] = arg.slice(2).split("=")
    flags[key] = rest.length ? rest.join("=") : true
  }
  return flags
}

function readConfigFile(file) {
  if (!file) return {}
  if (!fs.existsSync(file)) {
    throw new Error(`config file not found: ${file}`)
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"))
  } catch (err) {
    throw new Error(`config file ${file} is not valid JSON: ${err.message}`)
  }
}

function defaultConfigFile(flags) {
  if (flags.config) return path.resolve(String(flags.config))
  if (process.env.OA_E2E_CONFIG) return path.resolve(process.env.OA_E2E_CONFIG)
  const local = path.join(__dirname, "..", "agents.config.json")
  return fs.existsSync(local) ? local : null
}

/** Per-agent credentials from the environment, for a keyless config file. */
function envCred(type) {
  const upper = type.toUpperCase().replace(/[^A-Z0-9]/g, "_")
  const pick = (suffix) => process.env[`OA_E2E_${upper}_${suffix}`] || ""
  const cred = {}
  if (pick("API_KEY")) cred.apiKey = pick("API_KEY")
  if (pick("BASE_URL")) cred.baseUrl = pick("BASE_URL")
  if (pick("MODEL")) cred.model = pick("MODEL")
  return cred
}

function minutes(value, fallbackMin) {
  const n = Number(value)
  return (Number.isFinite(n) && n > 0 ? n : fallbackMin) * 60_000
}

function seconds(value, fallbackSec) {
  const n = Number(value)
  return (Number.isFinite(n) && n >= 0 ? n : fallbackSec) * 1_000
}

function buildConfig(argv) {
  const flags = parseArgs(argv)
  const file = defaultConfigFile(flags)
  const doc = readConfigFile(file)

  const workspace = {
    apiBase:
      flags["ws-api"] ||
      process.env.OA_E2E_WS_API ||
      process.env.WORKSPACE_API_BASE_URL ||
      (doc.workspace && doc.workspace.apiBase) ||
      DEFAULT_API_BASE,
    token:
      flags["ws-token"] ||
      process.env.OA_E2E_WS_TOKEN ||
      (doc.workspace && doc.workspace.token) ||
      "",
    id:
      flags["ws-id"] ||
      process.env.OA_E2E_WS_ID ||
      (doc.workspace && (doc.workspace.id || doc.workspace.slug)) ||
      "",
  }

  const defaults = doc.defaults || {}
  const configured = doc.agents || {}
  // `--agents=a,b` narrows the matrix; without it every configured agent runs.
  const requested = flags.agents
    ? String(flags.agents)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : Object.keys(configured)

  const agents = requested.map((type) => {
    const entry = { ...(configured[type] || {}) }
    const fromEnv = envCred(type)
    return {
      type,
      label: entry.label || type,
      model: fromEnv.model || entry.model || defaults.model || "",
      apiKey: fromEnv.apiKey || entry.apiKey || defaults.apiKey || "",
      baseUrl: fromEnv.baseUrl || entry.baseUrl || defaults.baseUrl || "",
      env: { ...(defaults.env || {}), ...(entry.env || {}) },
      files: entry.files || {},
      prompt: entry.prompt || doc.prompt || DEFAULT_PROMPT,
      expect: entry.expect || doc.expect || DEFAULT_EXPECT,
      skip: entry.skip || null,
    }
  })

  const homeDir = path.resolve(
    flags.home ||
      process.env.OA_E2E_HOME ||
      path.join(os.homedir(), ".openagents-e2e", "home"),
  )

  return {
    configFile: file,
    workspace,
    agents,
    homeDir,
    outDir: path.resolve(
      flags.out ||
        process.env.OA_E2E_OUT ||
        path.join(os.homedir(), ".openagents-e2e", "runs"),
    ),
    appPath: flags.app ? String(flags.app) : process.env.OA_LAUNCHER_BIN || "",
    fresh: !!flags.fresh,
    attach: !!flags.attach,
    keep: !!flags.keep,
    reinstall: !!flags.reinstall,
    json: !!flags.json,
    timeouts: {
      boot: minutes(flags["boot-timeout"], DEFAULTS.bootTimeoutMin),
      install: minutes(flags["install-timeout"], DEFAULTS.installTimeoutMin),
      start: minutes(flags["start-timeout"], DEFAULTS.startTimeoutMin),
      reply: minutes(flags["reply-timeout"], DEFAULTS.replyTimeoutMin),
      // A just-started agent needs a moment to join the workspace and begin
      // reading its channel; a message posted before that is simply missed.
      settle: seconds(flags.settle, DEFAULTS.settleSec),
      // How often the slow waits ask again. Installs run for minutes; polling
      // them every second buys nothing and floods the log.
      poll: seconds(flags.poll, DEFAULTS.pollSec),
    },
    help: !!flags.help,
  }
}

/** Everything the run must have before it starts doing slow things. */
function validate(config) {
  const problems = []
  if (!config.workspace.token) {
    problems.push(
      "no workspace token — set workspace.token in the config file or OA_E2E_WS_TOKEN",
    )
  }
  if (!config.workspace.id) {
    problems.push(
      "no workspace — set workspace.id in the config file or OA_E2E_WS_ID",
    )
  }
  if (!config.agents.length) {
    problems.push(
      config.configFile
        ? `no agents configured in ${config.configFile}`
        : "no config file found — copy tests/end_to_end/agents.example.json and fill it in",
    )
  }
  return problems
}

/** Every secret this run knows, for redacting logs before they hit disk. */
function secretsOf(config) {
  return [
    config.workspace.token,
    ...config.agents.flatMap((a) => [a.apiKey, ...Object.values(a.env)]),
  ]
}

module.exports = {
  buildConfig,
  validate,
  secretsOf,
  DEFAULT_PROMPT,
  DEFAULT_EXPECT,
}

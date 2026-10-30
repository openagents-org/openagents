#!/usr/bin/env node
"use strict"

/**
 * Launcher end-to-end test — one entry point, three platforms.
 *
 *   node tests/end_to_end/run.js [--agents=claude,codex] [--fresh] [--attach]
 *
 * What it proves, per agent, on the machine it runs on:
 *
 *   pair a workspace → install the agent → create an instance → configure its
 *   credentials → connect it to the workspace → start it → send it a message
 *   → read its answer.
 *
 * It drives the desktop launcher headlessly through the control server
 * (packages/launcher/src/main/control-server.ts) — the same AgentManager the UI
 * calls over IPC — so it needs no display and runs the same way from a terminal,
 * an SSH session, or a scheduled job. Exit code is 0 only when every agent that
 * had credentials passed.
 *
 * See README.md for configuration and the daily-run setup.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")

const { buildConfig, validate, secretsOf } = require("./lib/config")
const { startLauncher, attachLauncher } = require("./lib/launcher")
const { mintPairingCode, checkWorkspace } = require("./lib/workspace")
const { runAgent } = require("./lib/scenario")
const { renderConsole, writeArtifacts, summarize } = require("./lib/report")
const {
  ensureDir,
  nowStamp,
  makeRedactor,
  writeFileSafe,
  formatDuration,
} = require("./lib/util")

const USAGE = `
Launcher end-to-end test

  node tests/end_to_end/run.js [options]

Options
  --agents=a,b          Only these agent types (default: every agent in the config file)
  --config=<file>       Config file (default: tests/end_to_end/agents.config.json)
  --app=<path>          Launcher binary to test (default: the installed app, then the local build)
  --home=<dir>          Profile directory the run uses as HOME (default: ~/.openagents-e2e/home)
  --out=<dir>           Where results and diagnostics go (default: ~/.openagents-e2e/runs)
  --fresh               Delete the profile first — proves the from-nothing path (slow)
  --attach              Use a launcher that is already running under --home
  --reinstall           Install the agent even when it is already installed
  --keep                Leave the created agents behind (for debugging)
  --json                Print only the results JSON
  --boot-timeout=<min>  Wait for the core to load (default 12)
  --install-timeout=<min>  Per-agent install (default 20)
  --start-timeout=<min>    Agent reaching a running state (default 3)
  --reply-timeout=<min>    Agent answering (default 6)
  --settle=<sec>        Wait after start before messaging the agent (default 15)
  --poll=<sec>          How often the slow waits re-check (default 10)
  --help
`

async function main() {
  const config = buildConfig(process.argv.slice(2))
  if (config.help) {
    process.stdout.write(USAGE)
    return 0
  }

  const problems = validate(config)
  if (problems.length) {
    process.stderr.write(
      `Cannot start:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`,
    )
    return 2
  }

  const redact = makeRedactor(secretsOf(config))
  const startedAt = new Date()
  const outDir = ensureDir(path.join(config.outDir, nowStamp()))
  const logFile = path.join(outDir, "run.log")
  const log = (line) => {
    const text = redact(String(line))
    if (!config.json) process.stdout.write(`${text}\n`)
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`)
  }

  log(`Launcher end-to-end — ${startedAt.toISOString()}`)
  log(`host: ${process.platform}/${process.arch}, node ${process.version}`)
  if (config.configFile) log(`config: ${config.configFile}`)
  log(`output: ${outDir}`)

  if (config.fresh && !config.attach) {
    // --fresh deletes a directory tree. A --home that is (or contains) the real
    // home would take the user's account with it, so refuse rather than trust
    // the flag.
    const real = path.resolve(os.homedir())
    const target = path.resolve(config.homeDir)
    if (target === real || real.startsWith(`${target}${path.sep}`)) {
      process.stderr.write(
        `Refusing --fresh: ${target} is your real home directory (or contains it).\n` +
          "Point --home at a dedicated profile directory.\n",
      )
      return 2
    }
    log(`fresh run — removing ${target}`)
    fs.rmSync(target, { recursive: true, force: true })
  }

  const run = {
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: 0,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    host: os.hostname(),
    launcherVersion: null,
    coreVersion: null,
    fresh: config.fresh,
    workspace: { id: config.workspace.id, slug: null },
    results: [],
    ok: false,
    outDir,
  }

  let launcher = null
  try {
    // 1. The workspace has to exist and the token has to work before we spend
    //    ten minutes booting a launcher.
    const remote = await checkWorkspace(config.workspace)
    log(`workspace: ${remote.name} (${remote.slug})`)

    // 2. Boot the app (or attach to one already running). Ctrl-C from here on
    //    must still take the launcher down — a stranded headless Electron is
    //    invisible and would hold the profile for the next run.
    process.once("SIGINT", () => {
      process.stderr.write("\ninterrupted — stopping the launcher\n")
      const stop = launcher ? launcher.stop() : Promise.resolve()
      stop.finally(() => process.exit(130))
    })
    launcher = config.attach
      ? await attachLauncher({ homeDir: config.homeDir, log })
      : await startLauncher({
          appPath: config.appPath,
          homeDir: config.homeDir,
          outDir,
          bootTimeoutMs: config.timeouts.boot,
          log,
        })
    const control = launcher.control
    const status = await control.status()
    run.launcherVersion = status.version || null
    log(`launcher ${status.version} (headless=${status.headless})`)

    // 3. Pair this device with the workspace — where a person starts, and the
    //    only way a workspace reaches the launcher.
    // Retried with a FRESH code each time: codes are single-use, so a redeem
    // that failed after the server consumed it cannot be repeated. Worth the
    // retry because the failure seen in practice is a dropped TLS handshake on
    // the way out — one blip should not paint a whole nightly red.
    for (let attempt = 1; ; attempt++) {
      const { code } = await mintPairingCode(config.workspace)
      log(`pairing with code ${code.slice(0, 2)}**-****`)
      try {
        await control.pair(code)
        break
      } catch (err) {
        if (attempt >= 3) throw err
        log(`pairing failed (${err.message}) — retrying`)
        await new Promise((r) => setTimeout(r, attempt * 5_000))
      }
    }
    const local = (await control.workspaces()).find(
      (w) => w && (w.id === remote.id || w.slug === remote.slug),
    )
    if (!local) {
      throw new Error(
        `pairing reported success but ${remote.slug} is not registered on this device`,
      )
    }
    run.workspace = {
      id: local.id || remote.id,
      slug: local.slug || remote.slug,
    }
    log(`paired: ${run.workspace.slug}`)

    const catalog = await control.catalog().catch(() => null)
    run.coreVersion = (catalog && catalog.core && catalog.core.version) || null
    const supported = new Set((catalog && catalog.supported) || [])

    // 4. Each agent, in turn.
    for (const agent of config.agents) {
      log("")
      log(`── ${agent.type} ${"─".repeat(Math.max(0, 40 - agent.type.length))}`)
      if (supported.size && !supported.has(agent.type) && !agent.skip) {
        agent.skip = `not in this core's adapter map (core ${run.coreVersion || "?"})`
      }
      const result = await runAgent({
        control,
        config,
        agent,
        workspace: run.workspace,
        log,
        outDir,
        redact,
      })
      run.results.push(result)
    }
  } catch (err) {
    log(`\nrun aborted: ${err.message}`)
    run.error = err.message
  } finally {
    if (launcher) {
      log("")
      log("stopping the launcher")
      await launcher
        .stop()
        .catch((err) => log(`could not stop cleanly: ${err.message}`))
    }
  }

  run.finishedAt = new Date().toISOString()
  run.durationMs = Date.now() - startedAt.getTime()
  const counts = summarize(run.results)
  run.ok = !run.error && counts.fail === 0 && counts.total > 0
  run.summary = counts

  const { jsonPath, mdPath } = writeArtifacts(run, outDir, redact)
  // A fixed path the daily job can read without knowing the run's timestamp.
  writeFileSafe(
    path.join(config.outDir, "latest.json"),
    redact(JSON.stringify(run, null, 2)),
  )

  if (config.json) {
    process.stdout.write(`${redact(JSON.stringify(run, null, 2))}\n`)
  } else {
    process.stdout.write(`${renderConsole(run)}\n`)
    process.stdout.write(`\nresults: ${jsonPath}\nsummary: ${mdPath}\n`)
    if (run.error) process.stdout.write(`run aborted: ${run.error}\n`)
  }
  return run.ok ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = code
    // Let stdout drain (it is a pipe under cron/Task Scheduler, where writes are
    // asynchronous and process.exit would truncate the report), but never hang:
    // an unref'd timer forces the exit if something keeps the loop alive.
    setTimeout(() => process.exit(code), 5_000).unref()
  })
  .catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`)
    process.exit(1)
  })

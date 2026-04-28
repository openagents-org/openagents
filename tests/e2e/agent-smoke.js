#!/usr/bin/env node
"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");

// ---------------------------------------------------------------------------
// Config & constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 600_000;
const DAEMON_SETTLE_MS = 5000;
const AGENT_READY_MS = 15000;
const LOG_DIR = path.resolve(".e2e-logs");

const AGENTS = {
  hermes: {
    type: "hermes",
    install: ["agn", "install", "hermes"],
    create: (name) => ["agn", "create", name, "--type", "hermes"],
    update: ["agn", "update"],
  },
};

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const AGENT_TYPE = process.env.AGENT_TYPE || "hermes";
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || "";
const LLM_MODEL = process.env.LLM_MODEL || "";
const E2E_WS_TOKEN = process.env.E2E_WS_TOKEN;
const E2E_WS_SLUG = process.env.E2E_WS_SLUG;
const WORKSPACE_API_BASE_URL =
  process.env.WORKSPACE_API_BASE_URL ||
  "https://workspace-endpoint.openagents.org";

const SECRETS = [LLM_API_KEY, E2E_WS_TOKEN].filter(Boolean);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitize(str) {
  if (!str) return str;
  let out = String(str);
  for (const s of SECRETS) {
    if (s && s.length > 0) out = out.replaceAll(s, "***");
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

let runLogStream;
let agentLogStream;

function logRun(msg) {
  const line = `[${new Date().toISOString()}] ${sanitize(msg)}`;
  console.log(line);
  if (runLogStream) runLogStream.write(line + "\n");
}

function logAgent(msg) {
  if (agentLogStream) agentLogStream.write(sanitize(String(msg)));
}

function fatal(msg) {
  logRun(`FATAL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Command runner
// ---------------------------------------------------------------------------

function runCommand(args, { silent = false, allowFail = false, timeout = 120_000 } = {}) {
  const display = args
    .map((a) => {
      for (const s of SECRETS) {
        if (s && a === s) return "***";
      }
      return a;
    })
    .join(" ");
  if (!silent) logRun(`> ${display}`);
  try {
    const out = execFileSync(args[0], args.slice(1), {
      encoding: "utf-8",
      timeout,
      env: process.env,
    });
    if (!silent) logRun(out.trim());
    return out;
  } catch (err) {
    const stderr = sanitize(err.stderr || err.message || "");
    const stdout = sanitize(err.stdout || "");
    if (!silent) logRun(`  stderr: ${stderr}`);
    if (!silent && stdout) logRun(`  stdout: ${stdout}`);
    if (!allowFail) fatal(`Command failed: ${display}\n${stderr}`);
    return stdout || "";
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers (zero-dependency)
// ---------------------------------------------------------------------------

function httpRequest(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const opts = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { ...headers },
    };
    if (body) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function apiHeaders() {
  return {
    Authorization: `Bearer ${E2E_WS_TOKEN}`,
    "X-Workspace-Token": E2E_WS_TOKEN,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Workspace API wrappers
// ---------------------------------------------------------------------------

async function fetchEvents(params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${WORKSPACE_API_BASE_URL}/v1/events?${qs}`;
  const res = await httpRequest("GET", url, { headers: apiHeaders() });
  if (res.status < 200 || res.status >= 300) {
    fatal(`GET /v1/events returned ${res.status}: ${sanitize(JSON.stringify(res.data))}`);
  }
  return res.data;
}

async function postEvent(body) {
  const url = `${WORKSPACE_API_BASE_URL}/v1/events`;
  const res = await httpRequest("POST", url, { body, headers: apiHeaders() });
  if (res.status < 200 || res.status >= 300) {
    fatal(`POST /v1/events returned ${res.status}: ${sanitize(JSON.stringify(res.data))}`);
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function extractTextFromEvent(event) {
  const p = event.payload || {};
  return p.content || p.text || p.message || p.response || p.output || "";
}

function isAgentReply(event, agentName, sessionName) {
  if (event.type !== "workspace.message.posted") return false;
  if (event.source === "human:e2e") return false;
  const target = `channel/${sessionName}`;
  if (event.target !== target) return false;
  const p = event.payload || {};
  // Skip thinking/status messages — only accept actual chat replies
  const msgType = p.message_type || "chat";
  if (msgType === "thinking" || msgType === "status") return false;
  const isAgent =
    p.sender_type === "agent" ||
    (event.source && event.source.includes(agentName)) ||
    (event.source && event.source.startsWith("openagents:"));
  if (!isAgent) return false;
  const text = extractTextFromEvent(event);
  if (!text.trim() || text.trim().toLowerCase() === "thinking...") return false;
  return true;
}

async function pollForReply(agentName, sessionName, cursor, expected) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let after = cursor;
  while (Date.now() < deadline) {
    const params = { network: E2E_WS_SLUG, sort: "asc", limit: "50" };
    if (after) params.after = after;
    const res = await fetchEvents(params);
    const events = (res.data && res.data.events) || [];
    if (res.data && res.data.newest_id) after = res.data.newest_id;
    for (const ev of events) {
      if (isAgentReply(ev, agentName, sessionName)) {
        const text = extractTextFromEvent(ev);
        logRun(`Agent replied (event ${ev.id}): ${text.slice(0, 200)}`);
        return { event: ev, text, cursor: after };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  fatal(`Timed out waiting for agent reply after ${POLL_TIMEOUT_MS / 1000} seconds`);
}

// ---------------------------------------------------------------------------
// Hermes LLM configuration
// ---------------------------------------------------------------------------

function configureHermes() {
  const hermesDir = path.join(os.homedir(), ".hermes");
  ensureDir(hermesDir);

  // Write API key to .env
  const envContent = `OPENAI_API_KEY=${LLM_API_KEY}\n`;
  logRun("Writing ~/.hermes/.env (content redacted)");
  fs.writeFileSync(path.join(hermesDir, ".env"), envContent, "utf-8");

  // Patch config.yaml model section for CI (non-interactive)
  const configPath = path.join(hermesDir, "config.yaml");
  let configText = "";
  try {
    configText = fs.readFileSync(configPath, "utf-8");
  } catch {
    // No existing config — will create minimal one
  }

  if (LLM_BASE_URL && LLM_MODEL) {
    const modelBlock = [
      "model:",
      `  default: ${LLM_MODEL}`,
      "  provider: custom",
      `  base_url: ${LLM_BASE_URL}`,
      `  api_key: ${LLM_API_KEY}`,
    ].join("\n");

    if (configText && /^model:/m.test(configText)) {
      // Strip the entire model: block (top-level key + all indented lines below it)
      const lines = configText.split("\n");
      const out = [];
      let inModel = false;
      for (const line of lines) {
        if (/^model:\s*$/.test(line) || /^model:\s+/.test(line)) {
          inModel = true;
          continue;
        }
        if (inModel) {
          // Still inside model block if line is indented or blank
          if (/^\s+/.test(line) || line.trim() === "") continue;
          inModel = false;
        }
        out.push(line);
      }
      configText = modelBlock + "\n" + out.join("\n");
    } else if (configText) {
      configText = modelBlock + "\n" + configText;
    } else {
      configText = modelBlock + "\n";
    }

    fs.writeFileSync(configPath, configText, "utf-8");
    logRun(`Patched ~/.hermes/config.yaml: model=${LLM_MODEL}, provider=custom, base_url=${LLM_BASE_URL}`);
  } else {
    logRun(
      "LLM_BASE_URL or LLM_MODEL not set — skipping config.yaml patch. Hermes will use its existing model config."
    );
  }
}

// ---------------------------------------------------------------------------
// Agent-type dispatch
// ---------------------------------------------------------------------------

function configureLLM() {
  if (AGENT_TYPE === "hermes") {
    configureHermes();
  } else {
    fatal(`No LLM configuration handler for agent type: ${AGENT_TYPE}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // -- 1. Validate env -------------------------------------------------------
  const required = { AGENT_TYPE, LLM_API_KEY, E2E_WS_TOKEN, E2E_WS_SLUG };
  for (const [k, v] of Object.entries(required)) {
    if (!v) fatal(`Missing required env: ${k}`);
  }
  const agentDef = AGENTS[AGENT_TYPE];
  if (!agentDef) fatal(`Unknown AGENT_TYPE: ${AGENT_TYPE}`);

  // -- 2. Log directory & streams --------------------------------------------
  ensureDir(LOG_DIR);
  runLogStream = fs.createWriteStream(path.join(LOG_DIR, "e2e-run.log"));
  agentLogStream = fs.createWriteStream(path.join(LOG_DIR, "agent.log"));

  const envSummary = [
    `AGENT_TYPE=${AGENT_TYPE}`,
    `LLM_API_KEY=***`,
    `LLM_BASE_URL=${LLM_BASE_URL || "(not set)"}`,
    `LLM_MODEL=${LLM_MODEL || "(not set)"}`,
    `E2E_WS_TOKEN=***`,
    `E2E_WS_SLUG=${E2E_WS_SLUG}`,
    `WORKSPACE_API_BASE_URL=${WORKSPACE_API_BASE_URL}`,
  ].join("\n");
  fs.writeFileSync(path.join(LOG_DIR, "env-summary.log"), envSummary + "\n");
  logRun("=== Agent E2E Smoke Test ===");
  logRun(`Agent type: ${AGENT_TYPE}`);

  // -- 3. Unique names -------------------------------------------------------
  const runId = process.env.GITHUB_RUN_ID || String(Date.now());
  const agentName = `e2e-${AGENT_TYPE}-${runId}`;
  const sessionName = `e2e-${AGENT_TYPE}-${runId}`;
  const target = `channel/${sessionName}`;
  logRun(`agentName=${agentName}  sessionName=${sessionName}`);

  let daemonProc = null;

  try {
    // -- 4. Install runtime ----------------------------------------------------
    logRun("--- Step: install runtime ---");
    let runtimeInstalled = false;
    try {
      const out = execFileSync("which", [agentDef.type], { encoding: "utf-8", timeout: 5000 }).trim();
      if (out) {
        logRun(`Runtime '${agentDef.type}' already installed at ${out}, skipping install`);
        runtimeInstalled = true;
      }
    } catch {
      // not found, proceed with install
    }
    if (!runtimeInstalled) {
      runCommand(agentDef.install, { timeout: INSTALL_TIMEOUT_MS });
    }

    // -- 5. Configure LLM ------------------------------------------------------
    logRun("--- Step: configure LLM ---");
    configureLLM();

    // -- 6. Create agent -------------------------------------------------------
    logRun("--- Step: create agent ---");
    try {
      runCommand(agentDef.create(agentName));
    } catch (err) {
      fatal(`Failed to create agent: ${agentName} — ${sanitize(err.message)}`);
    }

    // -- 7. Connect workspace --------------------------------------------------
    logRun("--- Step: connect workspace ---");
    try {
      runCommand(["agn", "connect", agentName, E2E_WS_TOKEN]);
    } catch (err) {
      fatal(`Failed to connect agent to workspace — ${sanitize(err.message)}`);
    }

    // -- 8. Start daemon -------------------------------------------------------
    logRun("--- Step: start daemon (background) ---");
    daemonProc = spawn("agn", ["up", "--foreground"], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: process.env,
    });
    daemonProc.stdout.on("data", (d) => logAgent(d));
    daemonProc.stderr.on("data", (d) => logAgent(d));
    daemonProc.unref();
    logRun(`Daemon PID: ${daemonProc.pid}`);
    await new Promise((r) => setTimeout(r, DAEMON_SETTLE_MS));

    // -- 9. Start agent --------------------------------------------------------
    logRun("--- Step: start agent ---");
    runCommand(["agn", "start", agentName]);

    // -- 9b. Wait for agent poll loop to be ready -----------------------------
    logRun(`Waiting ${AGENT_READY_MS / 1000}s for agent to join workspace and start polling...`);
    await new Promise((r) => setTimeout(r, AGENT_READY_MS));

    // -- 10. Baseline cursor ---------------------------------------------------
    logRun("--- Step: get baseline cursor ---");
    const baseline = await fetchEvents({
      network: E2E_WS_SLUG,
      sort: "asc",
      limit: "50",
    });
    let cursor = (baseline.data && baseline.data.newest_id) || null;
    logRun(`Baseline cursor: ${cursor || "(empty)"}`);

    // -- 11. Send first message ------------------------------------------------
    logRun("--- Step: send first message ---");
    const msg1 = {
      type: "workspace.message.posted",
      source: "human:e2e",
      target,
      payload: {
        content: "2+2等于几？只回复数字。",
        sender_type: "human",
        mentions: [agentName],
        message_type: "chat",
      },
      metadata: { target_agents: [agentName] },
      visibility: "channel",
      network: E2E_WS_SLUG,
    };
    await postEvent(msg1);
    logRun("Message sent, polling for reply...");

    // -- 12. Poll first reply --------------------------------------------------
    logRun("--- Step: poll first reply ---");
    const reply1 = await pollForReply(agentName, sessionName, cursor, "4");
    cursor = reply1.cursor;

    // -- 13. Assert first reply ------------------------------------------------
    logRun("--- Step: assert first reply ---");
    if (!reply1.text || reply1.text.trim().length === 0) {
      fatal("Agent reply is empty");
    }
    if (!reply1.text.includes("4")) {
      logRun(`agentName: ${agentName}`);
      logRun(`sessionName: ${sessionName}`);
      logRun(`event id: ${reply1.event.id}`);
      logRun(`reply text: ${sanitize(reply1.text.slice(0, 500))}`);
      fatal('Agent reply did not contain expected value "4"');
    }
    logRun("First assertion passed: reply contains '4'");

    // -- 14. Update agent ------------------------------------------------------
    logRun("--- Step: agn update ---");
    runCommand(agentDef.update, { allowFail: true });

    // -- 15. Re-baseline cursor ------------------------------------------------
    logRun("--- Step: re-baseline cursor ---");
    // Use cursor from reply1 (already past the first reply event).
    // Fetch latest to ensure we skip any intermediate events (thinking, status).
    const baseline2 = await fetchEvents({
      network: E2E_WS_SLUG,
      after: cursor,
      sort: "asc",
      limit: "50",
    });
    if (baseline2.data && baseline2.data.newest_id) {
      cursor = baseline2.data.newest_id;
    }
    logRun(`Re-baseline cursor: ${cursor}`);

    // -- 16. Send second message -----------------------------------------------
    logRun("--- Step: send second message ---");
    const msg2 = {
      type: "workspace.message.posted",
      source: "human:e2e",
      target,
      payload: {
        content: "3+5等于几？只回复数字。",
        sender_type: "human",
        mentions: [agentName],
        message_type: "chat",
      },
      metadata: { target_agents: [agentName] },
      visibility: "channel",
      network: E2E_WS_SLUG,
    };
    await postEvent(msg2);
    logRun("Second message sent, polling for reply...");

    // -- 17. Poll & assert second reply ----------------------------------------
    logRun("--- Step: poll second reply ---");
    const reply2 = await pollForReply(agentName, sessionName, cursor, "8");

    logRun("--- Step: assert second reply ---");
    if (!reply2.text || reply2.text.trim().length === 0) {
      fatal("Agent reply after update is empty");
    }
    if (!reply2.text.includes("8")) {
      logRun(`agentName: ${agentName}`);
      logRun(`sessionName: ${sessionName}`);
      logRun(`event id: ${reply2.event.id}`);
      logRun(`reply text: ${sanitize(reply2.text.slice(0, 500))}`);
      fatal('Agent reply after update did not contain expected value "8"');
    }
    logRun("Second assertion passed: reply contains '8'");

    logRun("=== ALL CHECKS PASSED ===");
  } finally {
    // -- Cleanup ---------------------------------------------------------------
    logRun("--- Step: cleanup ---");
    const cleanupCmds = [
      ["agn", "stop", agentName],
      ["agn", "disconnect", agentName],
      ["agn", "remove", agentName],
      ["agn", "down"],
    ];
    for (const cmd of cleanupCmds) {
      try {
        runCommand(cmd, { allowFail: true });
      } catch {
        logRun(`Warning: cleanup command failed: ${cmd.join(" ")}`);
      }
    }
    if (daemonProc && !daemonProc.killed) {
      try {
        process.kill(-daemonProc.pid, "SIGTERM");
      } catch {
        try {
          daemonProc.kill("SIGTERM");
        } catch {
          logRun("Warning: could not kill daemon process");
        }
      }
    }
    if (runLogStream) runLogStream.end();
    if (agentLogStream) agentLogStream.end();
  }
}

main().catch((err) => {
  console.error(sanitize(err.message || String(err)));
  process.exitCode = 1;
});

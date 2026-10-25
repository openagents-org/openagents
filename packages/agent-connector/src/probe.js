'use strict';

/**
 * Agent smoke test ("probe") — answers the question static health checks
 * can't: does this agent actually produce a response on this device?
 *
 * healthCheck() proves a binary exists and credentials LOOK present; users
 * still hit "No response generated", invalid-key errors, and silent hangs at
 * message time. The probe closes that gap by running one tiny end-to-end
 * prompt ("hi") the same way the adapter would, then classifying whatever
 * came back into a machine code plus human guidance ("run `claude login` on
 * the device", "the API key is invalid", ...).
 *
 * Tiering (cheapest thing that proves liveness):
 *   1. healthCheck gate — not installed / not configured fails fast with the
 *      existing auth guidance, no process spawned, no tokens spent. An agent
 *      that declares a live CLI check still runs it: static sign-in checks
 *      miss keychains and CLI-side settings, and the run is the authority.
 *   2. Live check, picked from the registry entry:
 *      - `probe.args`            → run the agent CLI itself (e.g. --print hi)
 *      - `check_ready.alt_check` → run the entry's declared liveness command
 *      - saved API key           → one direct LLM API call (testLLMConnection)
 *      - none of the above       → report static checks only (never guess a
 *        CLI invocation; a wrong flag would misreport a healthy agent).
 *
 * Results carry NO environment values. CLI output is truncated and scrubbed
 * of anything key-shaped before it leaves this module.
 */

const os = require('os');
// spawn() here is the WSL bridge from ./wsl: same signature as
// child_process.spawn, and a straight pass-through unless the resolved CLI
// lives on the other side of the Windows/WSL boundary.
const { spawn } = require('./wsl');
const { getEnhancedEnv } = require('./paths');
const { shouldUseShellForBinary, REASON } = require('./adapters/health-status');
const { decodeConsoleOutput, BENIGN_CLI_OUTPUT, stripCliNoise } = require('./adapters/utils');
const { formatAuthGuidance } = require('./auth-guidance');
const { isCliLogin, stripForCliLogin, typeEnvFor } = require('./env');

const PROBE_PROMPT = 'hi';
const DEFAULT_TIMEOUT_MS = 90_000;
const OUTPUT_CAP = 400;      // max chars of CLI output kept for diagnostics
const REPLY_CAP = 160;       // max chars of a successful reply echoed back

/** Failure codes, ordered roughly by how actionable they are for the user. */
const CODE = {
  OK: 'ok',
  STATIC_ONLY: 'static_only',
  UNKNOWN_TYPE: 'unknown_type',
  NOT_INSTALLED: 'not_installed',
  NOT_READY: 'not_ready',
  VERSION_INCOMPATIBLE: 'version_incompatible',
  INVALID_API_KEY: 'invalid_api_key',
  MISSING_API_KEY: 'missing_api_key',
  NOT_LOGGED_IN: 'not_logged_in',
  SESSION_EXPIRED: 'session_expired',
  OUT_OF_CREDIT: 'out_of_credit',
  RATE_LIMITED: 'rate_limited',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  EMPTY_RESPONSE: 'empty_response',
  BAD_MODEL: 'bad_model',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  CLI_ERROR: 'cli_error',
};

const BENIGN_OUTPUT = BENIGN_CLI_OUTPUT;
const withoutNoise = stripCliNoise;

/**
 * The install command for THIS device's platform.
 *
 * `entry.install_command` comes off the catalog API, which picks macOS → Linux
 * → Windows with no idea who is asking — so a Windows user was told to fix a
 * missing CLI by running a `curl … | bash` one-liner that cannot work there.
 * The entry's own per-platform `install` block is the authority (same rule as
 * Installer._getInstallCommand); the flat field stays as the fallback for
 * catalog entries that carry nothing else.
 */
function installCommandFor(entry) {
  const inst = (entry && entry.install) || {};
  const plat = process.platform === 'darwin' ? 'macos'
    : process.platform === 'win32' ? 'windows'
      : 'linux';
  return inst[plat] || inst.command || inst.npm || (entry && entry.install_command) || null;
}

/** Redact anything that looks like a secret before output leaves the device. */
function scrub(text) {
  if (!text) return '';
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-****')
    .replace(/(api[-_ ]?key["':\s=]+)[A-Za-z0-9_-]{8,}/gi, '$1****')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ****');
}

function tail(text, cap) {
  const s = scrub(String(text || '').trim());
  return s.length > cap ? '…' + s.slice(-cap) : s;
}

/**
 * Whether this agent authenticates via API key (configured/expected) rather
 * than a CLI login. Steers the wording for auth-flavored failures.
 */
function authFlavor(entry, agentEnv) {
  const cr = (entry && entry.check_ready) || {};
  const envCfg = (entry && entry.env_config) || [];
  const hasKeyField = envCfg.some((f) => f && /key/i.test(f.name || ''));
  // The type's own key names count too: a Kimi agent on KIMI_API_KEY whose
  // key was rejected was told its sign-in had expired and to run kimi login.
  const keyNames = [
    'LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', cr.saved_env_key,
    ...(cr.env_vars || []).filter((k) => /_API_KEY$/.test(k)),
    ...envCfg.filter((f) => f && f.password).map((f) => f.name),
  ];
  const hasSavedKey = !!agentEnv && keyNames.some((k) => k && agentEnv[k]);
  if (hasSavedKey || (hasKeyField && !cr.login_command)) return 'api_key';
  if (cr.login_command) return 'cli_login';
  return hasKeyField ? 'api_key' : 'cli_login';
}

/**
 * Classify a failed live check into a code. Pattern-matches the combined
 * output; callers turn the code into guidance via buildGuidance().
 */
/** Classify an error by its OUTPUT TEXT alone; null when nothing matches. */
function classifyOutputText(text) {
  // Relays word this their own way and answer 403 rather than 402, so the
  // English-and-402 pattern alone read "out of credit" as "bad credentials"
  // — the one misreading that sends a user to re-authenticate a working key.
  if (/credit balance|insufficient[_ ]?(quota|credits|funds)|payment required|\b402\b|billing|quota[_ ]?exceeded|exceeded your current quota|额度|余额|欠费|余额不足/.test(text)) return CODE.OUT_OF_CREDIT;
  if (/rate[- ]?limit|too many requests|\b429\b|overloaded|\b529\b/.test(text)) return CODE.RATE_LIMITED;
  if (/enotfound|econnrefused|econnreset|etimedout|eai_again|fetch failed|socket hang up|network error|self[- ]signed certificate|unable to get local issuer/.test(text)) return CODE.NETWORK;
  if (/api key.{0,24}(not set|not found|missing)|no api key|missing api key|environment variable.{0,40}(is )?(not set|required)/.test(text)) return CODE.MISSING_API_KEY;
  if (/invalid.{0,12}(api.?key|x-api-key|token)|incorrect api key|authentication[_ ]?error|invalid credentials|\b401\b|unauthorized|forbidden|\b403\b/.test(text)) return CODE.INVALID_API_KEY;
  // A sign-in that exists but has run out — Claude Code: "Failed to
  // authenticate: OAuth session expired and could not be refreshed".
  if (/session expired|could not be refreshed|(token|sign-?in|login) (has )?expired|run \/logout and \/login/.test(text)) return CODE.SESSION_EXPIRED;
  if (/not logged in|not authenticated|login required|authentication required|please (log ?in|sign ?in|authenticate)|(run|use) .{0,40}login|no credentials/.test(text)) return CODE.NOT_LOGGED_IN;
  if (/unrecognized_model|model_not_found|invalid model|issue with the selected model|unknown model|model.{0,40}(does not exist|not found|not exist|is not supported)/.test(text)) return CODE.BAD_MODEL;
  if (/\b50[234]\b|service (is )?(temporarily )?unavailable|temporarily unavailable|bad gateway|gateway time-?out/.test(text)) return CODE.SERVICE_UNAVAILABLE;
  return null;
}

function classifyFailure(output, { timedOut = false, spawnError = null } = {}) {
  if (spawnError && /ENOENT/.test(String(spawnError))) return CODE.NOT_INSTALLED;
  const text = String(output || '').toLowerCase();
  if (timedOut) {
    // A CLI that retries a hard API error (bad key, unknown model, quota)
    // until the probe clock runs out is NOT "waiting for interactive input" —
    // the collected output already names the real problem. Only an output
    // with no recognizable error is a genuine timeout.
    return (text && classifyOutputText(text)) || CODE.TIMEOUT;
  }
  if (!text && spawnError) return CODE.CLI_ERROR;
  return classifyOutputText(text) || CODE.CLI_ERROR;
}

/** Human next-steps for a code. Plain strings, no markup, no secrets. */
function buildGuidance(code, entry, agentEnv, extra = {}) {
  const label = (entry && (entry.label || entry.name)) || 'This agent';
  const type = (entry && entry.name) || 'agent';
  const login = entry && entry.check_ready && entry.check_ready.login_command;
  const flavor = authFlavor(entry, agentEnv);
  const lines = [];
  switch (code) {
    case CODE.NOT_INSTALLED:
      lines.push(`${label} is not installed on this device. Install it from the launcher's Install page.`);
      {
        const cmd = installCommandFor(entry);
        if (cmd) lines.push(`Or install manually: ${cmd}`);
      }
      break;
    case CODE.INVALID_API_KEY:
    case CODE.MISSING_API_KEY:
      if (flavor === 'cli_login' && login) {
        lines.push(`${label}'s sign-in looks invalid or expired. On the device, run: ${login}`);
      } else {
        lines.push(code === CODE.MISSING_API_KEY
          ? `${label} has no API key configured. Add one in the launcher (Agents → ${label} → Configure) or edit the agent in the workspace and enter a key.`
          : `${label}'s API key was rejected by the provider. Replace it in the launcher (Agents → ${label} → Configure) or edit the agent in the workspace.`);
        lines.push(`To verify a key on the device: agn test-llm ${type}`);
      }
      break;
    case CODE.NOT_LOGGED_IN:
      lines.push(login
        ? `${label} is not signed in on this device. In a terminal there, run: ${login}`
        : `${label} is not signed in on this device. Sign in with its CLI, then re-run the test.`);
      break;
    case CODE.SESSION_EXPIRED:
      lines.push(login
        ? `${label}'s sign-in on this device has expired. In a terminal there, run: ${login}`
        : `${label}'s sign-in on this device has expired. Sign in again with its CLI, then re-run the test.`);
      break;
    case CODE.OUT_OF_CREDIT:
      lines.push(`The provider account for ${label} is out of credit or quota. Add credit, or switch the agent to a different API key or model.`);
      break;
    case CODE.RATE_LIMITED:
      lines.push(`The provider is rate-limiting ${label}. Wait a few minutes and test again.`);
      break;
    case CODE.NETWORK:
      lines.push(`The device could not reach the model provider. Check the device's network, proxy, and firewall, then test again.`);
      break;
    case CODE.TIMEOUT:
      lines.push(`${label} did not answer within ${Math.round((extra.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000)}s. It may be waiting for interactive input (a first-run consent or login prompt).`);
      lines.push(`On the device, run the agent's CLI once in a terminal to clear any prompt, then test again.`);
      break;
    case CODE.EMPTY_RESPONSE:
      lines.push(`${label} exited without producing a response. Run its CLI manually on the device to see what it prints.`);
      break;
    case CODE.BAD_MODEL:
      lines.push(`The configured model isn't recognized or isn't served by ${label}'s endpoint. Pick a different model in the launcher (Agents → ${label} → Configure) or edit the agent in the workspace.`);
      break;
    case CODE.SERVICE_UNAVAILABLE:
      lines.push(`The model provider for ${label} is temporarily unavailable. Wait a few minutes and test again.`);
      break;
    case CODE.VERSION_INCOMPATIBLE:
      lines.push(`The installed ${label} version is not the one OpenAgents supports. Reinstall it from the launcher's Install page.`);
      {
        const cmd = installCommandFor(entry);
        if (cmd) lines.push(`Or reinstall manually: ${cmd}`);
      }
      break;
    case CODE.NOT_READY:
      // Caller supplies the static-auth guidance lines instead.
      break;
    default:
      lines.push(`${label} failed to respond. Run its CLI manually on the device to inspect the error.`);
      break;
  }
  return lines;
}

/**
 * Ask the model endpoint directly why an agent is not answering.
 *
 * Only ever used to REPLACE a verdict that explains nothing, and only when it
 * can do better: a successful call means the endpoint is healthy and whatever
 * ails the CLI is the CLI's own, which the caller's vaguer answer already says
 * more honestly than "everything is fine" would. Likewise an unclassifiable
 * error — swapping one shrug for another helps nobody.
 */
async function directApiVerdict(agentEnv, entry) {
  // Required here rather than at the top so a test can stand in for it, and
  // so a probe that never reaches this path never loads the HTTP client.
  const { testLLMConnection } = require('./utils');
  let res;
  try {
    res = await testLLMConnection(agentEnv);
  } catch (e) {
    res = { success: false, error: e.message };
  }
  if (!res || res.success) return null;
  const code = classifyFailure(res.error, {});
  if (code === CODE.CLI_ERROR) return null;
  return {
    ok: false,
    method: 'llm_api',
    code,
    message: tail(res.error, OUTPUT_CAP),
    guidance: buildGuidance(code, entry, agentEnv),
  };
}

/**
 * Stop a CLI that ran too long. On Windows a .cmd shim runs under cmd.exe, and
 * killing that leaves the node process it started alive (see cli-models.js).
 */
function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
      if (killer && typeof killer.on === 'function') killer.on('error', () => {});
    } catch {}
  }
  try { child.kill('SIGKILL'); } catch {}
}

/**
 * A resolved binary as cmd.exe must see it. Node hands a shell: true spawn to
 * cmd.exe as one unquoted line, so a CLI under "F:\Program Files\…" or a
 * profile folder with a space in it was cut at the space and the probe read
 * "'F:\Program' is not recognized" (in GBK, as mojibake).
 */
function shellQuoted(binary, shell) {
  return shell && !/^".*"$/.test(binary) ? `"${binary}"` : binary;
}

/**
 * The one line worth reporting from a failed run.
 *
 * Stderr used to win outright, so a harmless warning there hid the real error
 * on stdout, and a timeout with any output never said it timed out. Now: the
 * line that the classifier recognised, else the output minus known noise,
 * with the timeout named first.
 */
function failureMessage(res, code, timeoutMs) {
  const lines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !BENIGN_OUTPUT.test(l));
  const all = [...lines(res.stderr), ...lines(res.stdout)];
  const telling = all.find((l) => classifyOutputText(l.toLowerCase()) === code);
  const detail = tail(telling || lines(res.stderr).join('\n') || lines(res.stdout).join('\n'), OUTPUT_CAP);
  if (res.timedOut) {
    const prefix = `Timed out after ${Math.round(timeoutMs / 1000)}s`;
    return detail ? `${prefix}: ${detail}` : prefix;
  }
  return detail || `Exited with code ${res.code}`;
}

/** Run a CLI to completion with a hard timeout. Never rejects. */
function runCommand(cmd, args, { env, timeoutMs, shell = false }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        env,
        cwd: os.homedir(),
        shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: 1, stdout: '', stderr: '', spawnError: e.message, timedOut: false });
      return;
    }
    // Bytes, decoded once at the end: a multi-byte character can straddle two
    // chunks, and cmd.exe's own errors are in the console code page.
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let settled = false;
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: decodeConsoleOutput(Buffer.concat(stdout)),
        stderr: decodeConsoleOutput(Buffer.concat(stderr)),
        spawnError: spawnError || null,
        timedOut,
      });
    };
    // Settles here and not on 'close' alone: a grandchild that survives the
    // kill can hold stdout open, and 'close' then never comes.
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      finish(1);
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout.push(Buffer.from(d)); });
    child.stderr.on('data', (d) => { stderr.push(Buffer.from(d)); });
    child.on('error', (e) => finish(1, e.message));
    child.on('close', (code) => finish(code == null ? 1 : code));
  });
}

/**
 * Smoke-test one agent type end to end. Returns a result object; never throws.
 *
 * @param {object} connector AgentConnector (registry/installer/env access)
 * @param {string} type      agent type name (registry entry name)
 * @param {object} [opts]    { timeoutMs }
 */
async function probeAgentType(connector, type, opts = {}) {
  const startedAt = Date.now();
  const done = (fields) => ({
    type,
    at: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    guidance: [],
    ...fields,
  });

  const entry = connector.registry.getEntry(type);
  if (!entry) {
    return done({ ok: false, method: 'none', code: CODE.UNKNOWN_TYPE, message: `Unknown agent type '${type}'` });
  }

  // A signed-in agent is ready on its sign-in alone: judged on the type, a
  // key it will never be given made it "pass" with no login at all.
  const cliLogin = isCliLogin(opts.agentEnv);
  let health = {};
  try { health = connector.healthCheck(type, { cliLogin, agentEnv: opts.agentEnv }) || {}; } catch (e) {
    health = { installed: false, ready: false, message: e.message };
  }

  // opts.agentEnv is one agent's own env, layered over the type's the way
  // the daemon builds it; a signed-in agent then carries no key from either.
  let agentEnv = {};
  try {
    const typeEnv = typeEnvFor(type, connector.getAgentEnv(type) || {}, connector.registry, opts.agentEnv);
    const saved = { ...typeEnv, ...(opts.agentEnv || {}) };
    const resolved = connector.resolveAgentEnv(type, saved) || {};
    agentEnv = stripForCliLogin(type, { ...saved, ...resolved }, connector.registry, opts.agentEnv);
  } catch {}

  if (!health.installed) {
    return done({
      ok: false, method: 'none', code: CODE.NOT_INSTALLED,
      message: 'Not installed',
      guidance: buildGuidance(CODE.NOT_INSTALLED, entry, agentEnv),
    });
  }

  // Installed, but not a version this integration supports. Not a sign-in
  // problem, so the sign-in guidance would only send the user the wrong way.
  if (health.reason === REASON.VERSION_INCOMPATIBLE || health.compatible === false) {
    return done({
      ok: false, method: 'none', code: CODE.VERSION_INCOMPATIBLE,
      message: health.message || 'Unsupported version',
      guidance: buildGuidance(CODE.VERSION_INCOMPATIBLE, entry, agentEnv),
    });
  }

  // Hoisted above the CLI tier: a failing CLI probe consults it too (below),
  // and `skip_cli_with_key` hands keyed agents straight to it.
  // `probe.api_test: false` opts out for an agent whose key is not a model
  // API key (Cursor's is for Cursor's own service): an OpenAI-style call with
  // it proves nothing either way.
  const apiTestable = !(entry.probe && entry.probe.api_test === false);
  const hasApiKey = apiTestable && !!(agentEnv.LLM_API_KEY || agentEnv.OPENAI_API_KEY || agentEnv.ANTHROPIC_API_KEY
    || agentEnv.ANTHROPIC_AUTH_TOKEN || agentEnv.KIMI_API_KEY || agentEnv.MOONSHOT_API_KEY);

  // `probe.skip_cli_with_key`: the adapter points the CLI at a key's endpoint
  // with launch flags (Codex's `-c model_providers…`) that a bare probe run
  // does not carry, so with a key the CLI would test the wrong endpoint.
  const cliProbeApplies = !(entry.probe && entry.probe.skip_cli_with_key && hasApiKey);
  const probeArgs = cliProbeApplies && entry.probe && Array.isArray(entry.probe.args) ? entry.probe.args : null;
  const altCheck = entry.check_ready && entry.check_ready.alt_check;
  const hasLiveCli = !!((probeArgs && health.binary) || altCheck);

  // Definitively unconfigured (auth_status 'unknown' still gets a live try:
  // the real run is the final authority for unverifiable logins).
  let staticVerdict = null;
  if (!health.ready && health.auth_status !== 'unknown') {
    let lines = [];
    try { lines = formatAuthGuidance(entry, health).lines; } catch {}
    staticVerdict = {
      ok: false, method: 'none', code: CODE.NOT_READY,
      message: health.message || 'Not configured',
      guidance: lines.length ? lines : buildGuidance(CODE.NOT_LOGGED_IN, entry, agentEnv),
    };
    // A sign-in kept where the static checks cannot see it (a keychain, a
    // relay set up in the CLI's own settings) answered fine and was still
    // reported "Not logged in". Where the agent declares a live check, that
    // run decides; the static verdict only stands in when the run explains
    // nothing.
    if (!hasLiveCli) return done(staticVerdict);
  }

  const timeoutMs = opts.timeoutMs
    || (entry.probe && entry.probe.timeout_s ? entry.probe.timeout_s * 1000 : DEFAULT_TIMEOUT_MS);
  const env = stripForCliLogin(type, { ...getEnhancedEnv(), ...agentEnv }, connector.registry, opts.agentEnv);

  // ── Live tier 1: the agent's own CLI, when the registry declares how ──
  if (hasLiveCli) {
    const shell = probeArgs && health.binary ? shouldUseShellForBinary(health.binary) : true;
    const res = probeArgs && health.binary
      // Node refuses to spawn .cmd/.bat without a shell (EINVAL since the
      // CVE-2024-27980 hardening), which made every Windows CLI probe of an
      // npm-shim binary fail as "Exited with code 1" with no output.
      ? await runCommand(shellQuoted(health.binary, shell), probeArgs, { env, timeoutMs, shell })
      : await runCommand(altCheck, [], { env, timeoutMs, shell: true });
    const output = withoutNoise(`${res.stdout}\n${res.stderr}`);
    const reply = withoutNoise(res.stdout).trim();
    if (!res.timedOut && !res.spawnError && res.code === 0 && reply) {
      return done({
        ok: true, method: 'cli', code: CODE.OK,
        message: 'Responded',
        reply: tail(reply, REPLY_CAP),
      });
    }
    let code = res.code === 0 && !res.timedOut && !res.spawnError
      ? CODE.EMPTY_RESPONSE
      : classifyFailure(output, res);
    // A CLI probe spawn-ENOENT despite installed=true means the binary went
    // away between checks — report it as not installed, not a mystery error.
    if (code === CODE.NOT_INSTALLED) {
      return done({
        ok: false, method: 'cli', code,
        message: 'The agent binary could not be executed',
        guidance: buildGuidance(code, entry, agentEnv),
      });
    }
    // A CLI verdict is not always the true one. A relay answering 403 "out of
    // credit" makes Claude Code retry in silence until the probe's clock runs
    // out, and all that reaches here is a timeout with an unrelated warning on
    // stderr — which the guidance then reads as "it may be waiting for a login
    // prompt", sending the user to a terminal to fix something that is not
    // broken. Where the agent carries an endpoint and a key, ask the API the
    // same question directly: one round trip, and it says why.
    const unexplained = code === CODE.TIMEOUT || code === CODE.CLI_ERROR || code === CODE.EMPTY_RESPONSE;
    if (unexplained && hasApiKey) {
      const direct = await directApiVerdict(agentEnv, entry);
      if (direct) return done(direct);
    }
    if (unexplained && staticVerdict) return done(staticVerdict);

    return done({
      ok: false, method: 'cli', code,
      message: failureMessage(res, code, timeoutMs),
      guidance: buildGuidance(code, entry, agentEnv, { timeoutMs }),
    });
  }

  // ── Live tier 2: direct LLM API call for API-key agents (e.g. OpenClaw) ──
  if (hasApiKey || (entry.install && entry.install.api_only)) {
    const { testLLMConnection } = require('./utils');
    let res;
    try { res = await testLLMConnection(agentEnv); } catch (e) { res = { success: false, error: e.message }; }
    if (res && res.success) {
      return done({
        ok: true, method: 'llm_api', code: CODE.OK,
        message: 'Responded',
        reply: tail(res.response || '', REPLY_CAP),
      });
    }
    const code = classifyFailure(res && res.error, {});
    return done({
      ok: false, method: 'llm_api', code,
      message: tail(res && res.error, OUTPUT_CAP) || 'LLM API test failed',
      guidance: buildGuidance(code, entry, agentEnv),
    });
  }

  // ── No safe live probe — report the static result honestly rather than
  // inventing a CLI invocation that could misfire. Reaching here not ready
  // means the sign-in could not be checked (auth_status 'unknown'): that is
  // ok: null, not a failure — counted as one, every signed-in Codex or Cursor
  // whose status command was slow read as "Not configured". ──
  return done({
    ok: health.ready === true ? true : null, method: 'none', code: CODE.STATIC_ONLY,
    auth_status: health.auth_status || null,
    message: health.ready
      ? 'Static checks passed (no live probe is defined for this agent type)'
      : (health.message || 'Not configured'),
  });
}

module.exports = { probeAgentType, classifyFailure, buildGuidance, authFlavor, installCommandFor, scrub, CODE, DEFAULT_TIMEOUT_MS };

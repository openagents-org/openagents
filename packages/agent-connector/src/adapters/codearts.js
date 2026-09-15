/**
 * CodeArts Agent adapter — Huawei Cloud's 码道 (CodeArts) code agent CLI.
 *
 * The CLI is built on OpenCode. Its binary (shipped as `agentkernel`, installed
 * as `codearts`) takes OpenCode's `run --format json`, streams OpenCode's JSON
 * events and resumes with `--session`, so the stream parsing, sessions, stop
 * control and failure taxonomy are OpenCodeAdapter's. What differs is how the
 * CLI is found, launched and authenticated (verified against 26.9.3):
 *
 *   - Installed by Huawei's own script (install.sh / install.ps1) into
 *     ~/.codeartsdoer/installers, never npm. What PATH finds there is a wrapper
 *     (`codearts.cmd` / a shell script) that sets the CLI's environment and runs
 *     bin/codearts(.exe). The adapter runs that binary itself with the same
 *     environment: through the .cmd it would need a cmd.exe host, and an
 *     attached console is what makes an OpenCode-based CLI open its TUI instead
 *     of running headless.
 *   - Non-interactive commands authenticate with a Huawei Cloud access key
 *     pair and nothing else — CODEARTS_CLI_AK / CODEARTS_CLI_SK. The browser
 *     sign-in the TUI offers does not reach them: without the pair, `auth list`,
 *     `models` and `run` all fail with "认证失败，没有设置环境变量
 *     CODEARTS_CLI_AK/CODEARTS_CLI_SK".
 *   - `run` has no --dir; the working directory is the spawn cwd.
 *   - `--auto` runs tools in always_allow mode. A headless run has nobody to
 *     answer a permission prompt; the daemon is the approval boundary, as it is
 *     for every other agent here.
 *   - A model the account cannot use is reported on stderr — "error: 未找到模型：
 *     …" — and the CLI still exits 0 with nothing on stdout.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OpenCodeAdapter = require('./opencode');
const { whichBinary } = require('../paths');
const { isWslBinary } = require('../wsl');

const IS_WINDOWS = process.platform === 'win32';

/** Newest CLI this adapter was checked against. Newer still runs, flagged. */
const CODEARTS_TESTED_VERSION = '26.9.3';

/**
 * Used only when `codearts models` can't be read. What an account may run is
 * decided by Huawei Cloud per account: the `huaweicloud-maas/deepseek-v3.2`
 * from Huawei's getting-started guide was not in a real account's list
 * (2026-09-15, which listed GLM-5.2, GLM-5.2-ArkTS-SPARK and OpenPangu-2.0
 * Flash/Pro), and every message to it failed.
 */
const DEFAULT_MODEL = 'huaweicloud-maas/GLM-5.2';

/** How long a read of `codearts models` is trusted, and how long a failed one waits. */
const MODEL_LIST_TTL_MS = 10 * 60_000;
const MODEL_LIST_RETRY_MS = 60_000;

/** Where the CLI itself sends people to create the access key it needs. */
const AKSK_URL = 'https://codearts.huaweicloud.com/portal/settings/cli-auth';

const DOWNLOAD_URL = 'https://codearts.huaweicloud.com/download.html';

const FAILURE_MESSAGES = {
  cli_not_found: `CodeArts Agent CLI not found. Install it (${DOWNLOAD_URL}) and try again.`,
  cli_not_executable: 'CodeArts Agent CLI was found but could not be started. Reinstall it, then retry.',
  unsupported_version: 'This CodeArts Agent CLI version is not supported. Update it with `codearts upgrade` and retry.',
  model_missing: "No model is configured for CodeArts Agent. Set CODEARTS_MODEL (provider/model) in this agent's configuration, then retry.",
  credential_missing: `CodeArts Agent needs a Huawei Cloud access key. Set CODEARTS_CLI_AK and CODEARTS_CLI_SK in this agent's configuration (create them at ${AKSK_URL}), then retry.`,
  auth_failed: 'Huawei Cloud rejected the access key, or this account has no CodeArts seat. Check CODEARTS_CLI_AK / CODEARTS_CLI_SK and ask your administrator for a seat if needed, then retry.',
  provider_not_configured: 'CodeArts Agent has no usable model provider. Check CODEARTS_MODEL, then retry.',
  model_not_found: "This account can't use the configured model. Pick one from the model list in this agent's configuration (or run `codearts models`), set CODEARTS_MODEL, then retry.",
  rate_limited: 'The model service is rate-limiting requests. Wait a moment and retry.',
  network_error: 'CodeArts Agent could not reach Huawei Cloud (network or service error). Retry shortly.',
  provider_server_error: 'The model service returned a server error. Retry shortly.',
  timeout: 'CodeArts Agent timed out before producing a reply. Retry; if it persists, check the model configuration.',
  stream_parse_error: 'CodeArts Agent produced output this version could not parse. Update the CLI, or open diagnostics.',
  empty_response: 'CodeArts Agent finished without producing a final reply. Retry; if it persists, open diagnostics.',
  incomplete_run: 'CodeArts Agent stopped mid-task right after a tool call and never produced a final reply — its progress notes are shown above. Send "continue" to pick up where it left off.',
  process_crashed: 'CodeArts Agent exited unexpectedly. Open diagnostics or retry.',
  cwd_unavailable: "CodeArts Agent's working directory is not accessible. Check the agent's configured path (or agent home) permissions.",
  unknown_error: 'CodeArts Agent failed for an undetermined reason. Open diagnostics or retry.',
};

/**
 * The CLI's own error line. On failure it prints a chunk of its bundled source
 * before the line that matters, and classifying that source text would find
 * "network" or "timeout" in someone's variable names — so only this line counts.
 */
function errorLine(text) {
  const matches = String(text || '').match(/^\s*error:\s*(.+)$/gm);
  if (!matches) return '';
  return matches[matches.length - 1].replace(/^\s*error:\s*/, '').trim();
}

class CodeArtsAdapter extends OpenCodeAdapter {
  /** Where Huawei's installer puts the CLI. */
  static installRoot(home = os.homedir()) {
    return path.join(home, '.codeartsdoer', 'installers');
  }

  /**
   * Where a command that belongs to no project (listing models) runs. Created
   * on demand; falls back to the home directory if it cannot be.
   */
  static probeDir(home = os.homedir()) {
    const dir = path.join(home, '.openagents', 'probe');
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      return home;
    }
  }

  /**
   * `codearts models` prints a table, not OpenCode's one id per line:
   *
   *   model_id                              model_name
   *   ------------------------------------------------
   *   huaweicloud-maas/GLM-5.2              GLM-5.2
   */
  static parseModels(out) {
    const ids = [];
    for (const line of String(out || '').split(/\r?\n/)) {
      const id = line.trim().split(/\s+/)[0] || '';
      if (/^[A-Za-z0-9][\w.-]*\/\S+$/.test(id) && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  _cliLabel() {
    return 'CodeArts Agent';
  }

  _installHint() {
    return `Install it from ${DOWNLOAD_URL}`;
  }

  _failureMessages() {
    return FAILURE_MESSAGES;
  }

  _findOpencodeBinary() {
    const exe = IS_WINDOWS ? 'codearts.exe' : 'codearts';
    const native = path.join(CodeArtsAdapter.installRoot(), 'bin', exe);
    if (fs.existsSync(native)) return native;

    // Somewhere else on PATH — a relocated install, or one inside WSL. When
    // that is the installer's wrapper, run the binary beside it instead.
    const found = whichBinary('codearts');
    if (!found) return null;
    if (!isWslBinary(found)) {
      const sibling = path.join(path.dirname(found), 'bin', exe);
      if (fs.existsSync(sibling)) return sibling;
    }
    return found;
  }

  _spawnEnv() {
    const configDir = path.join(os.homedir(), '.codeartsdoer');
    return {
      ...(this.agentEnv || process.env),
      // What the installer's wrapper sets before it runs the binary, set the
      // same unconditional way: an OPENCODE_CONFIG inherited from the user's
      // own OpenCode would otherwise point this CLI at the wrong config.
      //
      // One line of the wrapper is deliberately left out:
      // NODE_TLS_REJECT_UNAUTHORIZED=0 turns off certificate checks for every
      // request the CLI makes, and a headless run has not been seen to need it.
      SCENARIO: 'codeartsdoer',
      KERNEL_DATA_DIR: path.join(configDir, 'cli-data'),
      KERNEL_CONFIG_DIR: configDir,
      OPENCODE_CHANNEL: 'latest',
      OPENCODE_CONFIG: path.join(configDir, 'codearts_cli.json'),
      OPENCODE_CONFIG_FILE: 'codearts_cli.json,codearts_cli.jsonc',
      OPENCODE_MODE: 'tui',
      PLUGIN_ENV: 'hc',
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCODE_ALWAYS_NOTIFY_UPDATE: 'false',
      CODEARTS_DISABLE_AUTO_UPDATE: 'true',
      CODEAGENT_USE_MESSAGE_FEEDBACK: 'false',
      OMO_SEND_ANONYMOUS_TELEMETRY: '0',
    };
  }

  _buildRunArgs({ model, sessionId }) {
    const args = ['run', '--format', 'json', '--auto', '--model', model];
    if (sessionId) args.push('--session', sessionId);
    return args;
  }

  /**
   * The configured model, else the first one this account's `codearts models`
   * lists, else DEFAULT_MODEL. Always a model: an OpenCode-based `run` with
   * none waits for an interactive pick that never comes.
   */
  _resolveModel() {
    const env = this.agentEnv || process.env;
    const configured = String(env.CODEARTS_MODEL || '').trim();
    if (configured) return configured;
    return this._listModelIds()[0] || DEFAULT_MODEL;
  }

  /**
   * The ids `codearts models` lists for this agent's access key, cached. It
   * takes a few seconds (it asks Huawei Cloud), so it is read once per key and
   * not per message; a failed read is retried after a minute rather than on
   * every message.
   */
  _listModelIds() {
    const env = this.agentEnv || process.env;
    const key = String(env.CODEARTS_CLI_AK || '');
    const now = Date.now();
    const cached = this._modelList;
    if (cached && cached.key === key) {
      const ttl = cached.ids.length ? MODEL_LIST_TTL_MS : MODEL_LIST_RETRY_MS;
      if (now - cached.at < ttl) return cached.ids;
    }
    let ids = [];
    const binary = this._opencodeBinary || this._findOpencodeBinary();
    if (binary && this._credentialState() === 'present') {
      try {
        const out = execFileSync(binary, ['models'], {
          encoding: 'utf-8',
          timeout: 20_000,
          windowsHide: true,
          env: this._spawnEnv(),
          // The CLI sets up a `.codeartsdoer/` project folder in whatever
          // directory it starts in. A listing belongs to no project, so it runs
          // in one of ours rather than in the daemon's working directory.
          cwd: CodeArtsAdapter.probeDir(),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        ids = CodeArtsAdapter.parseModels(out);
        if (ids.length) this._log(`CodeArts models for this key: ${ids.join(', ')}`);
      } catch (e) {
        this._log(`codearts models failed: ${errorLine(e && e.stderr) || (e && e.message) || e}`);
      }
    }
    this._modelList = { key, ids, at: now };
    return ids;
  }

  // No OpenAI-compatible gateway to declare: models come from Huawei Cloud.
  _customBaseUrl() {
    return '';
  }

  _ensureCustomProviderConfig() {}

  /** The access key pair is the only credential a non-interactive run accepts. */
  _credentialState() {
    const env = this.agentEnv || process.env;
    const has = (k) => !!String(env[k] || '').trim();
    return has('CODEARTS_CLI_AK') && has('CODEARTS_CLI_SK') ? 'present' : 'missing';
  }

  /**
   * Versions are date-shaped (26.9.3). No floor: nothing older is known to
   * break, and refusing a working CLI on a guess is worse than trying it.
   */
  static _classifyVersion(version) {
    if (!version || !/^\d+\.\d+/.test(String(version))) return 'unknown';
    return OpenCodeAdapter._cmpVer(version, CODEARTS_TESTED_VERSION) > 0 ? 'degraded' : 'ok';
  }

  /**
   * OpenCode's taxonomy, plus the refusals this CLI words its own way: a model
   * the account can't use, a missing or rejected key pair (both in Chinese) and
   * a missing seat.
   */
  static _classifyFailure(input = {}) {
    const result = super._classifyFailure(input);
    const hay = [
      input.stderr,
      input.stdout,
      input.stdoutErr && input.stdoutErr.message,
    ].filter(Boolean).join(' ');
    // Checked first: its wording ends "或当前未登录", which is not an auth failure
    // when the same key lists models fine.
    if (/未找到模型|模型不存在/.test(hay)) {
      return { ...result, category: 'model_not_found' };
    }
    if (/认证失败|CODEARTS_CLI_AK|CODEARTS_CLI_SK|\bseat\b/i.test(hay)) {
      return { ...result, category: 'auth_failed' };
    }
    return result;
  }

  /**
   * An exit 0 with no reply is only "empty" when the CLI said nothing. This one
   * exits 0 after printing its error to stderr, which OpenCode's reading
   * reported as an empty response and hid the reason.
   */
  static _outcomeForCleanExit(args = {}) {
    const outcome = super._outcomeForCleanExit(args);
    const line = errorLine(args.stderr);
    if (!outcome.failure || outcome.failure.category !== 'empty_response' || !line) return outcome;
    const cls = this._classifyFailure({ code: 0, signal: null, stdout: '', stderr: line });
    return {
      failure: {
        category: cls.category === 'unknown_error' || cls.category === 'stream_parse_error' ? 'unknown_error' : cls.category,
        diagnostic: `exit 0, stderr: ${line}`,
        detail: OpenCodeAdapter._redact(line).slice(0, 200),
      },
    };
  }
}

CodeArtsAdapter.DEFAULT_MODEL = DEFAULT_MODEL;
CodeArtsAdapter.AKSK_URL = AKSK_URL;
CodeArtsAdapter.errorLine = errorLine;

module.exports = CodeArtsAdapter;

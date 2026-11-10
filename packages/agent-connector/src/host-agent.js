'use strict';

/**
 * The agent a command runs inside of. `agn join` is meant to be run BY an
 * agent (Claude Code, Codex, ...) that a person already has open: it reads
 * which one from the variables that agent sets for the commands it runs, so
 * the workspace agent it creates is the same kind, signed in the same way,
 * and (for Claude Code) starts from the same conversation.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Checked in order; the first match wins. `session` is the env var holding
// the host's own session id, when the host exports one.
const HOSTS = [
  { type: 'claude', label: 'Claude Code', match: (e) => has(e.CLAUDE_CODE_SESSION_ID) || has(e.CLAUDECODE), session: 'CLAUDE_CODE_SESSION_ID' },
  { type: 'codex', label: 'Codex', match: (e) => has(e.CODEX_SESSION_ID) || has(e.CODEX_THREAD_ID), session: 'CODEX_SESSION_ID' },
  { type: 'codebuddy', label: 'CodeBuddy', match: (e) => has(e.CODEBUDDY_SESSION_ID), session: 'CODEBUDDY_SESSION_ID' },
  { type: 'gemini', label: 'Gemini CLI', match: (e) => has(e.GEMINI_CLI), session: 'GEMINI_CLI_SESSION_ID' },
  { type: 'opencode', label: 'OpenCode', match: (e) => has(e.OPENCODE) || has(e.OPENCODE_SESSION_ID), session: 'OPENCODE_SESSION_ID' },
  { type: 'cursor', label: 'Cursor', match: (e) => has(e.CURSOR_AGENT), session: null },
];

function has(v) { return typeof v === 'string' && v.trim() !== ''; }

/** `{ type, label, sessionId }` for the agent running this process, or null. */
function detectHostAgent(env = process.env) {
  for (const host of HOSTS) {
    if (!host.match(env)) continue;
    const sessionId = host.session && has(env[host.session]) ? env[host.session].trim() : null;
    return { type: host.type, label: host.label, sessionId };
  }
  return null;
}

/** Whether this process runs inside a sandbox that a background daemon would inherit. */
function sandboxedHost(env = process.env) {
  return has(env.CODEX_SANDBOX) || has(env.CODEX_SANDBOX_NETWORK_DISABLED);
}

// Variables a host sets for the commands it runs that describe ITS session.
// Handed on to a daemon (and from it to the agents it spawns), they make a
// spawned CLI believe it runs inside the host's session.
const HOST_SESSION_KEYS = new Set([
  'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_SESSION_ID', 'CLAUDE_AGENT_SDK_VERSION', 'AI_AGENT',
  'CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_VERSION',
  'CODEBUDDY_SESSION_ID', 'CODEBUDDY_TOOL_CALL_ID', 'CODEBUDDY_CONVERSATION_REQUEST_ID',
  'CODEBUDDY_SESSION_KIND', 'CODEBUDDY_SESSION_NAME', 'CODEBUDDY_SESSION_LOG',
  'GEMINI_CLI', 'GEMINI_CLI_SESSION_ID', 'OPENCODE_SESSION_ID', 'CURSOR_AGENT', 'CURSOR_TRACE_ID',
]);
// CLAUDE_CODE_* is mostly the host session's own wiring; these say how it signs in.
const KEPT_CLAUDE_CODE_KEYS = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']);

/** `env` without the host session's own variables. */
function hostFreeEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || HOST_SESSION_KEYS.has(key)) continue;
    if (key.startsWith('CLAUDE_CODE_') && !KEPT_CLAUDE_CODE_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

// How each type signs in and where it keeps its state, beyond the keys the
// registry lists. Copied onto the new agent so it runs the way the host does.
const AUTH_SETTINGS = {
  claude: [
    'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
    'ANTHROPIC_VERTEX_PROJECT_ID', 'CLOUD_ML_REGION', 'AWS_REGION', 'AWS_PROFILE',
  ],
  codex: ['CODEX_HOME', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'],
  codebuddy: ['CODEBUDDY_CONFIG_DIR', 'CODEBUDDY_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_GENAI_USE_VERTEXAI'],
  opencode: [
    'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY',
    'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'AZURE_API_KEY', 'AZURE_OPENAI_API_KEY',
    'GOOGLE_CLOUD_PROJECT', 'VERTEX_LOCATION', 'GOOGLE_APPLICATION_CREDENTIALS',
    'AWS_REGION', 'AWS_PROFILE',
  ],
  cursor: ['CURSOR_API_KEY'],
};
const SECRET_RE = /(KEY|TOKEN|SECRET)$/;

/**
 * The host's sign-in settings for `type`: `{ env, secrets }`, where `secrets`
 * lists the names (never the values) of credentials among them.
 */
function hostAuthEnv(type, env = process.env) {
  const out = {};
  const secrets = [];
  for (const key of AUTH_SETTINGS[type] || []) {
    if (!has(env[key])) continue;
    out[key] = env[key];
    if (SECRET_RE.test(key)) secrets.push(key);
  }
  return { env: out, secrets };
}

// ---------------------------------------------------------------------------
// Claude Code transcripts
// ---------------------------------------------------------------------------

function claudeConfigDir(env = process.env) {
  return has(env.CLAUDE_CONFIG_DIR) ? env.CLAUDE_CONFIG_DIR : path.join(os.homedir(), '.claude');
}

/** Claude Code keeps a cwd's sessions in projects/<cwd with every non-alphanumeric as '-'>. */
function claudeProjectDir(configDir, cwd) {
  return path.join(configDir, 'projects', String(cwd).replace(/[^A-Za-z0-9]/g, '-'));
}

/** The transcript file of a Claude Code session, searched across projects, or null. */
function findClaudeTranscript(sessionId, configDir) {
  if (!/^[A-Za-z0-9-]+$/.test(String(sessionId || ''))) return null;
  const projects = path.join(configDir, 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(projects); } catch { return null; }
  for (const d of dirs) {
    const file = path.join(projects, d, `${sessionId}.jsonl`);
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}

/**
 * Copy a transcript into `destDir` under the same session id, keeping only
 * complete lines: the source may be a chat that is still writing to it.
 */
function snapshotTranscript(src, destDir) {
  const text = fs.readFileSync(src, 'utf-8');
  const end = text.lastIndexOf('\n');
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  const dest = path.join(destDir, path.basename(src));
  fs.writeFileSync(dest, end >= 0 ? text.slice(0, end + 1) : '', { mode: 0o600 });
  return dest;
}

// ---------------------------------------------------------------------------
// OpenCode sessions
// ---------------------------------------------------------------------------
//
// OpenCode sets OPENCODE=1 for the commands it runs but no session id, so the
// session is found by where it runs: the most recently updated one in the
// directory the command was run from is the chat running it.

/** Pick the chat's session from `opencode session list --format json` output. */
function pickOpencodeSession(sessions, cwd) {
  const want = realpath(cwd);
  const here = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && s.id && s.directory && realpath(s.directory) === want)
    .sort((a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0));
  return here[0] || null;
}

function realpath(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(String(p || '')); }
}

/** `provider/model` the session runs on, from `opencode export <id>` output. */
function opencodeSessionModel(exported) {
  const m = exported && exported.info && exported.info.model;
  if (m && m.providerID && m.id) return `${m.providerID}/${m.id}`;
  const msgs = (exported && exported.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const info = msgs[i] && msgs[i].info;
    if (info && info.role === 'assistant' && info.providerID && info.modelID) return `${info.providerID}/${info.modelID}`;
  }
  return null;
}

/**
 * A plain-text transcript of an exported OpenCode session: what each side
 * said and which tools ran, newest part kept when it is longer than
 * `maxChars`. Reasoning is left out.
 */
function opencodeTranscript(exported, maxChars = 30000) {
  const lines = [];
  for (const msg of (exported && exported.messages) || []) {
    const role = msg && msg.info && msg.info.role === 'assistant' ? 'You' : 'User';
    for (const part of (msg && msg.parts) || []) {
      if (part.type === 'text' && part.text && !part.synthetic) {
        lines.push(`${role}: ${part.text.trim()}`);
      } else if (part.type === 'tool' && part.tool) {
        const state = part.state || {};
        const input = state.input ? JSON.stringify(state.input) : '';
        const output = typeof state.output === 'string' ? state.output.trim() : '';
        lines.push(`[You ran ${part.tool}${input ? ` ${input.slice(0, 500)}` : ''}${output ? ` → ${output.slice(0, 500)}` : ''}]`);
      }
    }
  }
  const text = lines.join('\n\n');
  if (text.length <= maxChars) return text;
  return `[…earlier part omitted…]\n\n${text.slice(text.length - maxChars)}`;
}

module.exports = {
  detectHostAgent, sandboxedHost, hostFreeEnv, hostAuthEnv,
  claudeConfigDir, claudeProjectDir, findClaudeTranscript, snapshotTranscript,
  pickOpencodeSession, opencodeSessionModel, opencodeTranscript,
  HOST_SESSION_KEYS,
};

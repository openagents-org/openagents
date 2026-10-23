/**
 * Shared utilities for adapter implementations.
 *
 * Direct port of Python: sdk/src/openagents/adapters/utils.py
 */

'use strict';

const SESSION_DEFAULT_RE = /^(Session \d+|session-[0-9a-f]+|channel-[0-9a-f]+)$/;

/**
 * Generate a short session title from the first user message.
 */
function generateSessionTitle(message, maxWords = 6) {
  // Collapse whitespace, strip code blocks
  let text = message.replace(/\s+/g, ' ').trim();
  text = text.replace(/```[\s\S]*?```/g, '').trim();
  text = text.replace(/`[^`]+`/g, '').trim();

  if (!text) return '';

  // Try to get first sentence
  const sentenceMatch = text.match(/^(.+?[.!?])\s/);
  if (sentenceMatch) {
    text = sentenceMatch[1].replace(/[.!?]+$/, '').trim();
  }

  // Take first maxWords words
  const words = text.split(/\s+/);
  if (words.length > maxWords) {
    text = words.slice(0, maxWords).join(' ');
  }

  // Strip common filler prefixes
  text = text.replace(
    /^(hey|hi|hello|please|can you|could you|i need you to|i want you to)\s+/i,
    ''
  ).trim();

  // Capitalize first letter
  if (text) {
    text = text[0].toUpperCase() + text.slice(1);
  }

  // Hard cap at 50 characters
  if (text.length > 50) {
    text = text.slice(0, 47) + '...';
  }

  return text;
}

/**
 * Format attachment metadata into text to append to an agent prompt.
 *
 * `tokenExpr` is the SHELL EXPRESSION the agent should use for the workspace
 * token, not the token itself. It defaults to `$TOKEN` for the adapters that
 * already export the token under that name. An adapter whose prompt must never
 * contain the literal token (deepseek writes its prompt to a file and exports
 * OPENAGENTS_WORKSPACE_TOKEN into the child environment) passes its own
 * expression instead — otherwise `$TOKEN` expands to the empty string in the
 * child and every attachment download silently 401s.
 *
 * @param {Array} attachments
 * @param {'mcp'|'skills'} [toolMode='mcp']
 * @param {boolean} [isWindows]
 * @param {object} [opts]
 * @param {string} [opts.tokenExpr='$TOKEN'] shell expression yielding the token
 * @param {string} [opts.endpoint] base URL used when an attachment carries no
 *   absolute `url`. Without it the fallback emits a literal `{WORKSPACE_API}`
 *   placeholder that nothing substitutes.
 */
function formatAttachmentsForPrompt(
  attachments,
  toolMode = 'mcp',
  isWindows = process.platform === 'win32',
  { tokenExpr = '$TOKEN', endpoint = null } = {},
) {
  if (!attachments || attachments.length === 0) return null;

  const lines = ['\n[Attached files]'];
  for (const att of attachments) {
    const filename = att.filename || 'unknown';
    const fileId = att.fileId || '';
    const contentType = att.contentType || '';
    if (toolMode === 'skills') {
      const base = endpoint ? String(endpoint).replace(/\/+$/, '') : '{WORKSPACE_API}';
      const url = att.url || `${base}/v1/files/${fileId}`;
      const curl = isWindows ? 'curl.exe' : 'curl';
      const tmpDir = isWindows ? '$env:TEMP' : '/tmp';
      // A web upload's filename is its workspace path (uploaded_files/<stamp>_<name>)
      // and curl -o does not create folders, so that download failed with exit 23.
      const localName = filename.split(/[\\/]/).pop() || fileId || 'attachment';
      if (contentType.startsWith('image/')) {
        lines.push(
          `- Image: ${filename} (file_id: ${fileId}) — ` +
          `download with curl, then use your Read tool on the local file to view it:\n` +
          `  Step 1: ${curl} -s -H "X-Workspace-Token: ${tokenExpr}" "${url}" -o ${tmpDir}/${localName}\n` +
          `  Step 2: Use the Read tool on ${tmpDir}/${localName} to see the image`
        );
      } else {
        lines.push(
          `- File: ${filename} (file_id: ${fileId}, type: ${contentType}) — ` +
          `download with curl, then use your Read tool on the local file:\n` +
          `  Step 1: ${curl} -s -H "X-Workspace-Token: ${tokenExpr}" "${url}" -o ${tmpDir}/${localName}\n` +
          `  Step 2: Use the Read tool on ${tmpDir}/${localName} to read the file`
        );
      }
    } else {
      if (contentType.startsWith('image/')) {
        lines.push(
          `- Image: ${filename} (file_id: ${fileId}) — ` +
          'use workspace_read_file to view this image'
        );
      } else {
        lines.push(
          `- File: ${filename} (file_id: ${fileId}, type: ${contentType}) — ` +
          'use workspace_read_file to read this file'
        );
      }
    }
  }
  return lines.join('\n');
}

/**
 * Environment variable names whose value is a credential. Deliberately broad:
 * masking a value that turns out to be harmless costs one word of an error
 * notice, while missing a key posts it to every member of the workspace.
 */
const SECRET_NAME_RE = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH/i;
/** Shorter than this and a value is as likely a flag ("1", "true") as a secret. */
const MIN_SECRET_LENGTH = 8;

/**
 * The exact values an agent must never quote back: everything in its
 * environment whose name says it is a credential, plus whatever the caller
 * already knows to be one (the workspace token). Longest first, so a secret
 * that contains another is masked whole rather than leaving its tail behind.
 *
 * @param {object} env     the environment the agent's CLI runs with
 * @param {string[]} extra further values to mask
 * @returns {string[]}
 */
function secretValues(env, extra = []) {
  const out = new Set();
  const add = (value) => {
    const v = typeof value === 'string' ? value.trim() : '';
    if (v.length >= MIN_SECRET_LENGTH) out.add(v);
  };
  for (const [name, value] of Object.entries(env || {})) {
    if (SECRET_NAME_RE.test(name)) add(value);
  }
  for (const value of extra || []) add(value);
  return [...out].sort((x, y) => y.length - x.length);
}

/**
 * Mask known secret values in `text` and touch nothing else. For text that is
 * mostly prose or code — a model's partial answer — where the shape rules of
 * redactSecrets would rewrite ordinary words ("token limit", `password: string`).
 */
function maskSecretValues(text, secrets) {
  let out = String(text == null ? '' : text);
  for (const secret of secrets || []) {
    if (typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  return out;
}

/**
 * Strip secrets out of anything on its way to a log line or a channel message.
 *
 * Adapter diagnostics quote raw CLI output, and a CLI that fails on auth tends
 * to echo the credential it was handed. Two passes:
 *
 *   1. `secrets` — the values we already know are secret (see secretValues),
 *      masked wherever they appear. No pattern can know every provider's key
 *      format; this needs no format at all. It runs first because a pattern
 *      that recognises half of a key would otherwise leave the other half.
 *   2. The shapes that actually turn up in CLI output, for a credential that
 *      is not ours to know (another tool's token, a key in a config file). The
 *      closing catch-all takes any long opaque token the named patterns missed.
 *
 * Lived as a private static on two adapters before claude needed it as well —
 * a third identical copy is one copy too many for a security-relevant rule.
 *
 * @param {string} s
 * @param {string[]} [secrets] exact values to mask, e.g. from secretValues()
 */
function redactSecrets(s, secrets) {
  let out = maskSecretValues(s, secrets);
  out = out
    // scheme://user:password@host, and scheme://token@host.
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@?#]+@/gi, '$1[REDACTED]@')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-[REDACTED]')
    .replace(/\b(?:github_pat|gh[pousr])_[A-Za-z0-9_]{10,}/g, '[REDACTED_TOKEN]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, '[REDACTED_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{12,}/g, '[REDACTED_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[REDACTED_JWT]')
    // Google API keys are 39 chars, one short of the catch-all below.
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, '[REDACTED_KEY]')
    .replace(/\bya29\.[0-9A-Za-z_-]{20,}/g, '[REDACTED_TOKEN]')
    // key: value. An Authorization value is "<scheme> <credential>", so the
    // scheme word is skipped — taking it for the value masked "Bearer" and
    // left the token standing right behind it.
    .replace(/(authorization|api[_-]?key|x-api-key|token|bearer|secret|password|passwd)(["'\s:=]+)(?:(?:bearer|basic|token)[ \t]+)?([^\s"',}]+)/gi,
      (m, k, sep) => `${k}${sep}[REDACTED]`)
    // A Basic credential quoted without its header name. Base64 has no shape
    // of its own, so this wants padding or some length before it believes it.
    .replace(/\b(basic)[ \t]+(?:[A-Za-z0-9+/]{16,}={0,2}|[A-Za-z0-9+/]{4,}={1,2})/gi, '$1 [REDACTED]')
    .replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTED]')
    // Keys too short for the catch-all with no prefix to know them by: bare
    // hex (32+), and the "<32 hex>.<secret>" form Zhipu issues.
    .replace(/\b[0-9a-f]{32,}(?:\.[A-Za-z0-9]{8,})?\b/gi, '[REDACTED]');
  return out;
}

/**
 * Decode CLI output. The CLIs write UTF-8, but text that came from Windows
 * itself (cmd.exe, a system error) is in the console code page, which on a
 * Chinese system is GBK and showed up as rows of "�". Fall back to GB18030
 * only when UTF-8 fails and GB18030 reads the bytes cleanly.
 */
function decodeConsoleOutput(buf, isWindows = process.platform === 'win32') {
  const utf8 = buf.toString('utf-8');
  if (!isWindows || !utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('gb18030', { fatal: true }).decode(buf);
  } catch {
    return utf8;
  }
}

/**
 * Lines a CLI prints on a perfectly healthy run. Reported as "the" error,
 * they hid the real one. Claude Code warns about its claude.ai connectors
 * whenever a key is set, and about a model it does not know (any relay model:
 * glm, kimi, …) — "…so it assumes a context window of 200000 tokens … Until
 * then auto-compact keeps this session within 200k tokens".
 */
const BENIGN_CLI_OUTPUT = /claude\.ai connectors are disabled|doesn't recognize the model|assumes a context window|auto-compact keeps this session|CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT/i;

/** CLI output with the known-harmless lines taken out. */
function stripCliNoise(text) {
  return String(text || '').split(/\r?\n/).filter((l) => !BENIGN_CLI_OUTPUT.test(l)).join('\n');
}

module.exports = {
  SESSION_DEFAULT_RE,
  BENIGN_CLI_OUTPUT,
  stripCliNoise,
  decodeConsoleOutput,
  generateSessionTitle,
  formatAttachmentsForPrompt,
  redactSecrets,
  maskSecretValues,
  secretValues,
};

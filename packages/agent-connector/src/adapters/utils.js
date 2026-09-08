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
      if (contentType.startsWith('image/')) {
        lines.push(
          `- Image: ${filename} (file_id: ${fileId}) — ` +
          `download with curl, then use your Read tool on the local file to view it:\n` +
          `  Step 1: ${curl} -s -H "X-Workspace-Token: ${tokenExpr}" "${url}" -o ${tmpDir}/${filename}\n` +
          `  Step 2: Use the Read tool on ${tmpDir}/${filename} to see the image`
        );
      } else {
        lines.push(
          `- File: ${filename} (file_id: ${fileId}, type: ${contentType}) — ` +
          `download with curl, then use your Read tool on the local file:\n` +
          `  Step 1: ${curl} -s -H "X-Workspace-Token: ${tokenExpr}" "${url}" -o ${tmpDir}/${filename}\n` +
          `  Step 2: Use the Read tool on ${tmpDir}/${filename} to read the file`
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
 * Strip secrets out of anything on its way to a log line or a channel message.
 *
 * Adapter diagnostics quote raw CLI output, and a CLI that fails on auth tends
 * to echo the credential it was handed. The shapes here are the ones that
 * actually turn up in that output; the closing catch-all takes any long opaque
 * token the named patterns missed.
 *
 * Lived as a private static on two adapters before claude needed it as well —
 * a third identical copy is one copy too many for a security-relevant rule.
 */
function redactSecrets(s) {
  let out = String(s == null ? '' : s);
  out = out
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-[REDACTED]')
    .replace(/\b(?:github_pat|gh[pousr])_[A-Za-z0-9_]{10,}/g, '[REDACTED_TOKEN]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, '[REDACTED_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{12,}/g, '[REDACTED_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[REDACTED_JWT]')
    .replace(/(authorization|api[_-]?key|x-api-key|token|bearer|secret|password|passwd)(["'\s:=]+)([^\s"',}]+)/gi,
      (m, k, sep) => `${k}${sep}[REDACTED]`)
    .replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTED]');
  return out;
}

module.exports = {
  SESSION_DEFAULT_RE,
  generateSessionTitle,
  formatAttachmentsForPrompt,
  redactSecrets,
};

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
 * @param {Array} attachments
 * @param {'mcp'|'skills'} [toolMode='mcp']
 * @param {boolean} [isWindows]
 */
function formatAttachmentsForPrompt(attachments, toolMode = 'mcp', isWindows = process.platform === 'win32') {
  if (!attachments || attachments.length === 0) return null;

  const lines = ['\n[Attached files]'];
  for (const att of attachments) {
    const filename = att.filename || 'unknown';
    const fileId = att.fileId || '';
    const contentType = att.contentType || '';
    if (toolMode === 'skills') {
      const url = att.url || `{WORKSPACE_API}/v1/files/${fileId}`;
      const curl = isWindows ? 'curl.exe' : 'curl';
      const tmpDir = isWindows ? '$env:TEMP' : '/tmp';
      if (contentType.startsWith('image/')) {
        lines.push(
          `- Image: ${filename} (file_id: ${fileId}) — ` +
          `download with curl, then use your Read tool on the local file to view it:\n` +
          `  Step 1: ${curl} -s -H "X-Workspace-Token: $TOKEN" "${url}" -o ${tmpDir}/${filename}\n` +
          `  Step 2: Use the Read tool on ${tmpDir}/${filename} to see the image`
        );
      } else {
        lines.push(
          `- File: ${filename} (file_id: ${fileId}, type: ${contentType}) — ` +
          `download with curl, then use your Read tool on the local file:\n` +
          `  Step 1: ${curl} -s -H "X-Workspace-Token: $TOKEN" "${url}" -o ${tmpDir}/${filename}\n` +
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
 * Redact credentials from HTTP headers embedded in status text.
 */
function redactSensitiveHeaders(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(
    /(\b(?:authorization|(?:[a-z0-9]+-)*(?:token|key))\s*:\s*)(?:(?:bearer|basic|token)\s+)?[^\s"'`]+/gi,
    '$1[REDACTED]'
  );
}

module.exports = {
  SESSION_DEFAULT_RE,
  generateSessionTitle,
  formatAttachmentsForPrompt,
  redactSensitiveHeaders,
};

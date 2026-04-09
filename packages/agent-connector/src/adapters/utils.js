/**
 * Shared utilities for adapter implementations.
 *
 * Direct port of Python: src/openagents/adapters/utils.py
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { whichBinary } = require('../paths');

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
 */
function formatAttachmentsForPrompt(attachments) {
  if (!attachments || attachments.length === 0) return null;

  const lines = ['\n[Attached files]'];
  for (const att of attachments) {
    const filename = att.filename || 'unknown';
    const fileId = att.fileId || '';
    const contentType = att.contentType || '';
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
  return lines.join('\n');
}

/**
 * Find an executable on PATH, preferring Windows wrappers when needed.
 */
function findExecutable(...names) {
  if (!names || names.length === 0) return null;

  if (process.platform === 'win32') {
    for (const name of names) {
      for (const candidate of [`${name}.cmd`, `${name}.exe`, name]) {
        const found = whichBinary(candidate);
        if (found) return found;
      }
    }
    return null;
  }

  for (const name of names) {
    const found = whichBinary(name);
    if (found) return found;
  }
  return null;
}

/**
 * Return an env dict with HOME-style variables pointed at a runtime dir.
 */
function ensureRuntimeEnvHome(env, homeDir) {
  const updated = { ...(env || process.env) };
  const home = String(homeDir);
  updated.HOME = home;
  if (process.platform === 'win32') {
    updated.USERPROFILE = home;
  }
  return updated;
}

/**
 * Create parent directories and write JSON payload to disk.
 */
function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return filePath;
}

/**
 * Best-effort extraction of human-readable text from nested event payloads.
 */
function firstText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => firstText(item)).filter(Boolean).join('\n').trim();
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'delta', 'content', 'message', 'result', 'output', 'title', 'arguments']) {
      const extracted = firstText(value[key]);
      if (extracted) return extracted;
    }
    return '';
  }
  return String(value);
}

/**
 * Resolve how to invoke this package's CLI from child processes.
 */
function getCliInvocation() {
  return {
    command: process.execPath,
    args: [path.join(__dirname, '..', '..', 'bin', 'agent-connector.js')],
  };
}

/**
 * Build an MCP server config entry for the OpenAgents workspace server.
 */
function buildWorkspaceMcpServer(
  workspaceId,
  channelName,
  agentName,
  endpoint,
  token,
  { serverName = 'openagents-workspace', disableFiles = false, disableBrowser = false } = {}
) {
  const cli = getCliInvocation();
  const args = [
    ...cli.args,
    'mcp-server',
    '--workspace-id',
    workspaceId,
    '--channel-name',
    channelName,
    '--agent-name',
    agentName,
    '--endpoint',
    endpoint,
  ];
  if (disableFiles) args.push('--disable-files');
  if (disableBrowser) args.push('--disable-browser');

  return {
    [serverName]: {
      type: 'stdio',
      command: cli.command,
      args,
      env: {
        OA_WORKSPACE_TOKEN: token,
      },
    },
  };
}

module.exports = {
  SESSION_DEFAULT_RE,
  generateSessionTitle,
  formatAttachmentsForPrompt,
  findExecutable,
  ensureRuntimeEnvHome,
  writeJsonFile,
  firstText,
  getCliInvocation,
  buildWorkspaceMcpServer,
};

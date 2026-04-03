/**
 * Adapter registry — maps agent type names to adapter classes.
 */

'use strict';

const BaseAdapter = require('./base');
const OpenClawAdapter = require('./openclaw');
const ClaudeAdapter = require('./claude');
const CodexAdapter = require('./codex');
const OpenCodeAdapter = require('./opencode');
const NanoClawAdapter = require('./nanoclaw');
const CursorAdapter = require('./cursor');

const ADAPTER_MAP = {
  openclaw: OpenClawAdapter,
  claude: ClaudeAdapter,
  codex: CodexAdapter,
  opencode: OpenCodeAdapter,
  nanoclaw: NanoClawAdapter,
  cursor: CursorAdapter,
};

/**
 * Create an adapter instance for the given agent type.
 * @param {string} type - Agent type (openclaw, claude, codex, opencode, nanoclaw, cursor)
 * @param {object} opts - Adapter constructor options
 * @returns {BaseAdapter}
 */
function createAdapter(type, opts) {
  const AdapterClass = ADAPTER_MAP[type];
  if (!AdapterClass) {
    throw new Error(`Unknown agent type: ${type}. Supported: ${Object.keys(ADAPTER_MAP).join(', ')}`);
  }
  return new AdapterClass(opts);
}

module.exports = {
  BaseAdapter,
  OpenClawAdapter,
  ClaudeAdapter,
  CodexAdapter,
  OpenCodeAdapter,
  NanoClawAdapter,
  CursorAdapter,
  createAdapter,
  ADAPTER_MAP,
};

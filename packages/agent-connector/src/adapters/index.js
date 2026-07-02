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
const HermesAdapter = require('./hermes');
const GeminiAdapter = require('./gemini');
const KimiAdapter = require('./kimi');
const AiderAdapter = require('./aider');
const GooseAdapter = require('./goose');
const CopilotAdapter = require('./copilot');
const ClineAdapter = require('./cline');
const AmpAdapter = require('./amp');
const MiniSweAgentAdapter = require('./mini');

const ADAPTER_MAP = {
  openclaw: OpenClawAdapter,
  claude: ClaudeAdapter,
  codex: CodexAdapter,
  opencode: OpenCodeAdapter,
  nanoclaw: NanoClawAdapter,
  cursor: CursorAdapter,
  hermes: HermesAdapter,
  gemini: GeminiAdapter,
  kimi: KimiAdapter,
  aider: AiderAdapter,
  goose: GooseAdapter,
  copilot: CopilotAdapter,
  cline: ClineAdapter,
  amp: AmpAdapter,
  'mini-swe-agent': MiniSweAgentAdapter,
};

/**
 * Create an adapter instance for the given agent type.
 * @param {string} type - Agent type (openclaw, claude, codex, opencode, nanoclaw, cursor, hermes, gemini, kimi, aider, goose, copilot, cline, amp, mini-swe-agent)
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
  HermesAdapter,
  GeminiAdapter,
  KimiAdapter,
  AiderAdapter,
  GooseAdapter,
  CopilotAdapter,
  ClineAdapter,
  AmpAdapter,
  MiniSweAgentAdapter,
  createAdapter,
  ADAPTER_MAP,
};

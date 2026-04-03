/**
 * NanoClaw adapter — lightweight containerized coding agent.
 *
 * Uses direct LLM API mode (OpenAI-compatible chat completions).
 * Port of Python: src/openagents/adapters/nanoclaw.py
 */

'use strict';

const LlmDirectAdapter = require('./llm-direct');

class NanoClawAdapter extends LlmDirectAdapter {
  constructor(opts) {
    super({
      ...opts,
      adapterLabel: 'NanoClaw',
      modelEnvVar: 'NANOCLAW_MODEL',
    });
  }
}

module.exports = NanoClawAdapter;

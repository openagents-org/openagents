/**
 * Cursor adapter — AI-powered code editor agent mode.
 *
 * Uses direct LLM API mode (OpenAI-compatible chat completions).
 * Port of Python: src/openagents/adapters/cursor.py
 */

'use strict';

const LlmDirectAdapter = require('./llm-direct');

class CursorAdapter extends LlmDirectAdapter {
  constructor(opts) {
    super({
      ...opts,
      adapterLabel: 'Cursor',
      modelEnvVar: 'CURSOR_MODEL',
    });
  }
}

module.exports = CursorAdapter;

'use strict';

/**
 * The model an agent's env selects: the variable its adapter really reads.
 *
 * Each type names it its own way (CODEX_MODEL, ANTHROPIC_MODEL, KIMI_MODEL),
 * and the workspace and the launcher do not save it the same way: the
 * workspace writes LLM_MODEL, which env resolution maps onto the type's own
 * variable, while the launcher writes the type's variable directly. Whatever
 * reads the model has to look where the adapter looks. The smoke test read
 * LLM_MODEL alone, so a codex agent set up in the launcher, answering fine on
 * its CODEX_MODEL, was tested on a guessed "gpt-4o-mini" its relay refused.
 */

const { modelKeys } = require('./env');

/**
 * Model variables whose name does not follow `<TYPE>_MODEL`. Only the ones an
 * adapter really reads: `<TYPE>_MODEL` is tried first and LLM_MODEL last, so
 * nothing else needs an entry here.
 */
const MODEL_ENV_ALIASES = {
  claude: ['ANTHROPIC_MODEL', 'CLAUDE_MODEL'],
  gemini: ['GEMINI_MODEL', 'GOOGLE_GEMINI_MODEL'],
  antigravity: ['ANTIGRAVITY_MODEL', 'AGY_MODEL'],
  codex: ['CODEX_MODEL', 'OPENCLAW_MODEL'],
};

/**
 * Where to look, in order. `registry`, when given, adds the type's own model
 * fields and the variable LLM_MODEL resolves to.
 */
function modelVarsFor(agentType, registry) {
  const type = String(agentType || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const vars = [...(type ? [`${type}_MODEL`] : []), ...(MODEL_ENV_ALIASES[agentType] || [])];
  if (registry) {
    try {
      for (const key of modelKeys(agentType, registry)) if (key !== 'LLM_MODEL') vars.push(key);
    } catch {}
  }
  vars.push('LLM_MODEL');
  return [...new Set(vars)];
}

/**
 * The model `env` selects for an agent of `agentType`, or null when it sets
 * none and the agent runs on its CLI's default. Pass the env the agent is
 * launched on (saved and resolved): resolution has already put LLM_MODEL
 * where the adapter reads it.
 */
function configuredModel(agentType, env, registry) {
  if (!env) return null;
  for (const key of modelVarsFor(agentType, registry)) {
    const value = String(env[key] || '').trim();
    if (value) return value;
  }
  return null;
}

module.exports = { MODEL_ENV_ALIASES, modelVarsFor, configuredModel };

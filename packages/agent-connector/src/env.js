'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Manages ~/.openagents/env/<type>.env files and resolve_env rules.
 *
 * Env files use key=value format (one per line, # for comments).
 * resolve_env maps generic LLM_* vars to provider-specific vars
 * (e.g. LLM_API_KEY → OPENAI_API_KEY or ANTHROPIC_API_KEY).
 */
class EnvManager {
  constructor(configDir) {
    this.envDir = path.join(configDir, 'env');
  }

  /**
   * Load env vars from ~/.openagents/env/<agentType>.env
   */
  load(agentType) {
    const envFile = path.join(this.envDir, `${agentType}.env`);
    const env = {};
    try {
      if (!fs.existsSync(envFile)) return env;
      const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (key) env[key] = val;
      }
    } catch {}
    return env;
  }

  /**
   * Save env vars to ~/.openagents/env/<agentType>.env
   * Merges with existing values (new values override).
   */
  save(agentType, env) {
    fs.mkdirSync(this.envDir, { recursive: true });
    const envFile = path.join(this.envDir, `${agentType}.env`);
    const existing = this.load(agentType);
    const merged = { ...existing, ...env };
    const lines = Object.entries(merged)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(envFile, lines.join('\n') + '\n', 'utf-8');
  }

  /**
   * Delete env file for an agent type.
   */
  delete(agentType) {
    const envFile = path.join(this.envDir, `${agentType}.env`);
    try { fs.unlinkSync(envFile); } catch {}
  }

  /**
   * Apply resolve_env rules to map generic vars to provider-specific vars.
   *
   * Rules format (from YAML plugin definition):
   *   { from: 'LLM_API_KEY', to: 'OPENAI_API_KEY', unless_base_url_contains: 'anthropic' }
   *   { from: 'LLM_API_KEY', to: 'ANTHROPIC_API_KEY', if_base_url_contains: 'anthropic' }
   *   { from: 'LLM_BASE_URL', to: 'OPENAI_BASE_URL' }
   *
   * @param {object} saved - The saved env vars (from the env file)
   * @param {object[]} rules - The resolve_env rules from the registry
   * @returns {object} - The resolved env vars (provider-specific)
   */
  resolve(agentType, saved, registry) {
    const rules = registry ? registry.getResolveRules(agentType) : [];
    if (!rules || rules.length === 0) return saved;

    const resolved = {};
    const baseUrl = (saved.LLM_BASE_URL || '').toLowerCase();

    for (const rule of rules) {
      const src = rule.from || '';
      const dst = rule.to || '';
      let srcVal = saved[src];
      if (!srcVal || !dst) continue;

      // Conditional rules based on base URL
      if (rule.if_base_url_contains) {
        if (!baseUrl.includes(rule.if_base_url_contains.toLowerCase())) continue;
      }
      if (rule.unless_base_url_contains) {
        if (baseUrl.includes(rule.unless_base_url_contains.toLowerCase())) continue;
      }

      if (dst === 'ANTHROPIC_BASE_URL') srcVal = normalizeAnthropicBase(srcVal);
      resolved[dst] = srcVal;
    }

    return resolved;
  }

  /**
   * Get the full effective env for an agent: saved + resolved.
   */
  getEffective(agentType, registry) {
    const saved = { ...this.load(agentType) };
    // Same normalization as resolve(), for a base saved under the provider
    // key directly (agn env --set ANTHROPIC_BASE_URL=…, hand-edited files).
    if (saved.ANTHROPIC_BASE_URL) {
      saved.ANTHROPIC_BASE_URL = normalizeAnthropicBase(saved.ANTHROPIC_BASE_URL);
    }
    const resolved = this.resolve(agentType, saved, registry);
    return { ...saved, ...resolved };
  }
}

/**
 * Set on an agent's own env when it signs in through its CLI (`codex login`,
 * `claude auth login`) instead of a key. Keys stay shared per type in
 * <type>.env and the launcher's own environment, and a CLI prefers a key it
 * is handed over its account session, so without this an agent created on
 * the sign-in tab still ran on whatever key was saved there earlier.
 */
const AUTH_MODE_KEY = 'OPENAGENTS_AUTH_MODE';
const CLI_LOGIN = 'cli_login';

/**
 * Whether the agent signs in through its CLI. Read from the agent's own env
 * only: a marker in <type>.env or the launcher's environment would otherwise
 * strip the key of every agent of that type, keyed ones included.
 */
function isCliLogin(agentEnv) {
  return !!agentEnv && agentEnv[AUTH_MODE_KEY] === CLI_LOGIN;
}

/**
 * The variables that carry a key or an endpoint for this agent type: its
 * password and *_BASE_URL fields, and what LLM_API_KEY / LLM_BASE_URL resolve
 * to. The model is not among them, it applies to a sign-in as well. So is
 * CLAUDE_CODE_OAUTH_TOKEN: `claude setup-token` makes it from the account
 * sign-in, so it is how a signed-in claude authenticates, not a key to drop.
 */
function credentialKeys(agentType, registry) {
  const keys = new Set(['LLM_API_KEY', 'LLM_BASE_URL']);
  if (!registry) return keys;
  for (const field of registry.getEnvFields?.(agentType) || []) {
    if (field.password || /BASE_URL$/.test(field.name || '')) keys.add(field.name);
  }
  for (const rule of registry.getResolveRules?.(agentType) || []) {
    if (keys.has(rule.from) && rule.to) keys.add(rule.to);
  }
  return keys;
}

/**
 * `env` with every credential removed when the agent's own env (`agentEnv`)
 * marks a sign-in, or unchanged for an agent that runs on a key.
 */
function stripForCliLogin(agentType, env, registry, agentEnv) {
  if (!isCliLogin(agentEnv)) return env;
  const out = { ...env };
  for (const key of credentialKeys(agentType, registry)) delete out[key];
  return out;
}

/**
 * Anthropic's SDK appends the `/v1` segment itself: a base saved as
 * `https://relay.example/v1` makes the claude CLI call `…/v1/v1/messages`,
 * a 404 it mis-reports as "there's an issue with the selected model". The
 * launcher already strips the suffix for env saved through its UI
 * (env-normalize.ts); this is the same rule at the resolution layer, so env
 * written by ANY path — `agn env --set`, the workspace's remote
 * configure_agent command, a hand-edited file — is covered too. OpenAI-style
 * bases legitimately carry `/v1` and are left alone.
 */
function normalizeAnthropicBase(url) {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

module.exports = { EnvManager, AUTH_MODE_KEY, CLI_LOGIN, isCliLogin, credentialKeys, stripForCliLogin };

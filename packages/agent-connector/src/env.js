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
      const srcVal = saved[src];
      if (!srcVal || !dst) continue;

      // Conditional rules based on base URL
      if (rule.if_base_url_contains) {
        if (!baseUrl.includes(rule.if_base_url_contains.toLowerCase())) continue;
      }
      if (rule.unless_base_url_contains) {
        if (baseUrl.includes(rule.unless_base_url_contains.toLowerCase())) continue;
      }

      resolved[dst] = srcVal;
    }

    return resolved;
  }

  /**
   * Get the full effective env for an agent: saved + resolved.
   */
  getEffective(agentType, registry) {
    const saved = this.load(agentType);
    const resolved = this.resolve(agentType, saved, registry);
    return { ...saved, ...resolved };
  }
}

module.exports = { EnvManager };

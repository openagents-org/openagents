'use strict';

const PROVIDER_DEFAULTS = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-responses',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    api: 'google-generative-ai',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
  },
};

/** Keep Launcher keys separate from native Pi credentials when we can register the provider. */
function launcherProviderId({ provider, model, baseUrl, apiKey }) {
  const name = String(provider || '').trim().toLowerCase();
  if (name && String(model || '').trim() && String(apiKey || '').trim() &&
      (String(baseUrl || '').trim().replace(/\/+$/, '') || PROVIDER_DEFAULTS[name]?.baseUrl)) {
    return `openagents-${name}`;
  }
  return provider;
}

module.exports = { PROVIDER_DEFAULTS, launcherProviderId };

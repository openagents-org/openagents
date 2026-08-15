/**
 * Process-local Pi provider configured entirely by Launcher environment fields.
 *
 * This extension is loaded explicitly when PI_BASE_URL or the Launcher's
 * provider-neutral PI_API_KEY is set. It never persists settings or
 * credentials: the key is read from the child environment at runtime. That
 * keeps separate OpenAgents Pi instances isolated and leaves the user's
 * ~/.pi/agent/models.json and auth.json untouched.
 */

const value = (name) => String(process.env[name] || '').trim()

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
}

function providerKey(provider) {
  return value('PI_API_KEY') || {
    anthropic: value('ANTHROPIC_API_KEY'),
    openai: value('OPENAI_API_KEY'),
    deepseek: value('DEEPSEEK_API_KEY'),
    google: value('GEMINI_API_KEY'),
    openrouter: value('OPENROUTER_API_KEY'),
  }[provider] || ''
}

function apiFormat(provider) {
  const configured = value('PI_API_FORMAT').toLowerCase()
  if (configured && configured !== 'auto') return configured
  return PROVIDER_DEFAULTS[provider]?.api || 'openai-completions'
}

function isOfficialAnthropic(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'anthropic.com' || host.endsWith('.anthropic.com')
  } catch {
    return false
  }
}

export default function configureLauncherProvider(pi) {
  const provider = value('PI_PROVIDER').toLowerCase()
  const model = value('PI_MODEL')
  const key = providerKey(provider)
  const configuredBaseUrl = value('PI_BASE_URL')
  let baseUrl = (
    configuredBaseUrl || PROVIDER_DEFAULTS[provider]?.baseUrl || ''
  ).replace(/\/+$/, '')
  if (!baseUrl || !provider || !model || (!configuredBaseUrl && !key)) return

  const api = apiFormat(provider)
  // Anthropic's SDK appends /v1/messages itself. Accept either the service
  // root or the commonly copied .../v1 URL from a relay dashboard.
  if (api === 'anthropic-messages') baseUrl = baseUrl.replace(/\/v1$/i, '')
  const thinking = value('PI_THINKING').toLowerCase()
  const compat = {}
  if (provider === 'deepseek' || baseUrl.toLowerCase().includes('deepseek.com')) {
    compat.supportsDeveloperRole = false
  }

  pi.registerProvider(provider, {
    baseUrl,
    api,
    // Pass the resolved secret directly to the process-local provider. This is
    // deliberately not an argv flag or a persisted models.json/auth.json value.
    // It also avoids relying on Pi's built-in credential resolver, which has
    // failed to observe a present DEEPSEEK_API_KEY in some RPC launches.
    apiKey: key || undefined,
    // Anthropic's native endpoint uses x-api-key. The common relay convention
    // is Bearer auth; enabling it for non-official endpoints mirrors the
    // Launcher's Claude-agent behavior while leaving direct Anthropic untouched.
    authHeader: api === 'anthropic-messages' && !isOfficialAnthropic(baseUrl),
    ...(Object.keys(compat).length ? { compat } : {}),
    models: [
      {
        id: model,
        name: model,
        reasoning: !!thinking && thinking !== 'off',
        input: ['text', 'image'],
        // Pi's runtime cost calculator treats `cost` as required and reads its
        // tier list after every provider response. Launcher-managed relays can
        // have arbitrary pricing, so use an explicit zero-cost placeholder
        // instead of inventing charges. The provider still bills normally.
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          tiers: [],
        },
        contextWindow: 200000,
        maxTokens: 16384,
      },
    ],
  })
}

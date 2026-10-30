import { beforeEach, describe, expect, it, vi } from 'vitest'

const posthog = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn(), group: vi.fn() }))
vi.mock('posthog-js', () => ({ default: posthog }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('Launcher analytics', () => {
  it('never initializes or emits during development', async () => {
    vi.stubEnv('DEV', true)
    const analytics = await import('./analytics')
    analytics.initAnalytics()
    analytics.capture('app_opened')
    analytics.group('workspace', 'fixture')
    expect(posthog.init).not.toHaveBeenCalled()
    expect(posthog.capture).not.toHaveBeenCalled()
    expect(posthog.group).not.toHaveBeenCalled()
  })

  it('keeps explicit release events without replay or automatic UI collection', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    const analytics = await import('./analytics')
    analytics.initAnalytics()
    analytics.capture('agent_installed', { agent_type: 'test-cli' })
    expect(posthog.init).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      autocapture: false, capture_performance: false, disable_session_recording: true,
    }))
    expect(posthog.capture).toHaveBeenCalledWith('agent_installed', { agent_type: 'test-cli' })
  })
})

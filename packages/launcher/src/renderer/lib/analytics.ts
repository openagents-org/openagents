import posthog from "posthog-js"

const POSTHOG_KEY = "phc_t27xjrx9U42B54arcMwpiBgQxEFikBzXGnvzVtFEGtpf"

let enabled = false

export function initAnalytics(): void {
  if (import.meta.env.DEV || import.meta.env.MODE === "test" || navigator.webdriver) return
  enabled = true
  posthog.init(POSTHOG_KEY, {
    api_host: "https://d.openagents.org",
    person_profiles: "identified_only",
    capture_pageview: false,
    autocapture: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    rageclick: false,
    capture_performance: false,
    // Desktop debugging uses explicit funnel events; background windows and
    // development installs should not consume the shared replay allowance.
    disable_session_recording: true,
    persistence: "localStorage",
  })
  posthog.capture("app_opened")
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (enabled) posthog.capture(event, properties)
}

// Tie subsequent events to a workspace. The workspace slug is the join key that connects
// this install's onboarding to the website + workspace funnel stages for the same workspace.
export function group(groupType: string, groupKey: string, properties?: Record<string, unknown>): void {
  if (enabled) posthog.group(groupType, groupKey, properties)
}

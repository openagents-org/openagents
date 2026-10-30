# Product analytics collection

The hosted PostHog project is shared by Workspace, the website and Launcher.
Keep explicit acquisition, onboarding and human activity events; do not use it
as a backend event-stream mirror or a test-run log.

## Backend

Collection is off by default. The hosted production backend must explicitly set
both `ANALYTICS_ENABLED=true` and `POSTHOG_API_KEY` in its root-only environment
file. Its existing key must remain the same during this configuration change.
Local development, CI, rehearsal and isolated preview must not inherit these
production settings. Reserved example/test/invalid domains are always excluded.
The test suite continues to disable analytics even when a developer configures a
key locally. Tests of delivery use a fake key and mocked HTTP only.

## Workspace web

The snippet requires an explicit key, `VERCEL_ENV=production`, the production
Workspace hostname, and a non-WebDriver browser. Preview and local builds do not
load the SDK. Explicit product events and SPA pageviews are kept. Automatic
click/form events, pageleave, rage/dead clicks, web vitals and console capture are
disabled. Emit `workspace_opened` once after a successful load; configuring API
credentials must not emit another copy.

## Launcher

Development, tests and WebDriver do not initialize analytics. Packaged builds
keep explicit product events and screen pageviews; autocapture, pageleave,
performance events and replay are disabled. Installed older versions receive the
project-wide capture restrictions when they refresh remote configuration; the
code settings apply after a Launcher release.

## Project settings applied October 28, 2026

- Web replay sampling: 10%, previously 100%.
- Minimum replay duration: 10 seconds, previously no minimum.
- Replay URL exclusions: localhost/loopback, Vercel previews, the isolated
  workspace preview hostname, and desktop file URLs.
- Web autocapture and web-vitals autocapture: off.
- Existing billing caps and historical data are preserved.

The billing window September 28–October 28 showed roughly 1.02 million events
across the organization and 14,676 recordings in the shared OpenAgents project.
A raw event investigation found over 475,000 workspace creation events with
reserved fixture email domains. Such events are synthetic; filtering them only
in an insight does not stop ingestion. A recent 100-recording metadata sample
included 8 development/preview/desktop recordings and 16 with no clicks or keys;
this is a recent sample, not a random estimate for the entire month.

After rollout, compare the ingestion counts by event, SDK source and hostname.
Useful customer funnel events must remain; a drop in synthetic creation events
is expected. Sampling reduces future replay counts, not already accrued usage.

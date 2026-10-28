import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { workspaceAnalyticsScript } from './posthog-config';

describe('Workspace analytics collection boundary', () => {
  it.each([undefined, 'preview', 'development'])('does not initialize in %s deployments', (deployment) => {
    expect(workspaceAnalyticsScript('public-test-key', 'https://ingest.example', deployment)).toBeNull();
  });

  it('requires an explicitly configured project key', () => {
    expect(workspaceAnalyticsScript(undefined, 'https://ingest.example', 'production')).toBeNull();
  });

  it.each([
    ['localhost', false],
    ['workspace-preview.openagents.org', false],
    ['preview.vercel.app', false],
    ['workspace.openagents.org', true],
  ])('does not even load the SDK on %s (automated=%s)', (hostname, webdriver) => {
    const document = { createElement: vi.fn() };
    runInNewContext(workspaceAnalyticsScript('key', 'https://ingest.example', 'production')!, {
      window: { location: { hostname } }, navigator: { webdriver }, document,
    });
    expect(document.createElement).not.toHaveBeenCalled();
  });

  it('keeps production pageviews while disabling noisy automatic collection', () => {
    const init = vi.fn();
    // An already loaded SDK lets us execute the real bootstrap/init script.
    const posthog = { __SV: 1, init };
    runInNewContext(workspaceAnalyticsScript('key', 'https://ingest.example', 'production')!, {
      window: { location: { hostname: 'workspace.openagents.org' }, posthog },
      navigator: { webdriver: false }, document: {}, posthog,
    });
    expect(init).toHaveBeenCalledWith('key', expect.objectContaining({
      api_host: 'https://ingest.example', capture_pageview: 'history_change',
      autocapture: false, capture_pageleave: false, capture_performance: false,
    }));
    expect(init.mock.calls[0][1].disable_session_recording).toBeUndefined();
  });
});

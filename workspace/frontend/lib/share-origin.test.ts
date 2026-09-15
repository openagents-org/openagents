import { afterEach, describe, expect, it, vi } from 'vitest';

import { shareOrigin } from './share-origin';

/** The runner has no DOM; stub just the parts of `window` the helper reads. */
function openAt(href: string, globals: Record<string, unknown> = {}) {
  const { protocol, hostname, origin } = new URL(href);
  vi.stubGlobal('window', { location: { protocol, hostname, origin }, ...globals });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shareOrigin', () => {
  it('uses the page origin on a real deployment', () => {
    openAt('https://workspace.openagents.org/abc123');
    expect(shareOrigin()).toBe('https://workspace.openagents.org');
  });

  it('keeps a self-hosted origin', () => {
    openAt('https://ws.example.com/abc123');
    expect(shareOrigin()).toBe('https://ws.example.com');
  });

  it('falls back to the hosted app on localhost', () => {
    openAt('http://localhost:3000/abc123');
    expect(shareOrigin()).toBe('https://workspace.openagents.org');
  });

  it('uses the web origin the launcher hands to its bundled build', () => {
    openAt('openagents://workspace/index.html', { __OA_WEB_URL__: 'https://ws.example.com/' });
    expect(shareOrigin()).toBe('https://ws.example.com');
  });

  it('never returns the bundle scheme, even without a handed-over origin', () => {
    openAt('openagents://workspace/index.html');
    expect(shareOrigin()).toBe('https://workspace.openagents.org');
  });

  it('falls back to the hosted app while rendering on the server', () => {
    expect(shareOrigin()).toBe('https://workspace.openagents.org');
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { belongsElsewhere, handOffRoute } from './tabs';

const workspace = { kind: 'workspace' as const, aliases: ['acme', 'ws_123'] };

describe('launcher tab routing', () => {
  afterEach(() => { delete (window as { __oaHost__?: unknown }).__oaHost__; });

  it('keeps every route in the page without a launcher that has tabs', () => {
    expect(belongsElsewhere('/acme', null)).toBe(false);
    expect(handOffRoute('/acme')).toBe(false);
  });
  it('sends workspaces picked from the list to their own tab', () => {
    expect(belongsElsewhere('/acme', { kind: 'home' })).toBe(true);
    expect(belongsElsewhere('/', { kind: 'home' })).toBe(false);
  });
  it('keeps a workspace on its own routes under either of its names', () => {
    expect(belongsElsewhere('/acme/settings/members', workspace)).toBe(false);
    expect(belongsElsewhere('/ws_123/threads/t1', workspace)).toBe(false);
    expect(belongsElsewhere('/other', workspace)).toBe(true);
    expect(belongsElsewhere('/', workspace)).toBe(true);
  });
  it('opens invites and shares wherever they are asked for', () => {
    expect(belongsElsewhere('/invite/abc', { kind: 'home' })).toBe(false);
    expect(belongsElsewhere('/share/abc', workspace)).toBe(false);
  });
  it('hands a foreign route to the launcher and reports that it did', () => {
    const openRoute = vi.fn();
    (window as { __oaHost__?: unknown }).__oaHost__ = { tab: () => workspace, openRoute };
    expect(handOffRoute('/other?thread=x')).toBe(true);
    expect(openRoute).toHaveBeenCalledWith('/other?thread=x');
    expect(handOffRoute('/acme/files')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { agentPresence } from './helpers';

// Regression coverage for the mobile "already-connected agent still shows
// Connect-an-agent" bug. The empty-state / picker copy must be driven by
// workspace membership (does any agent exist?), not by online status.
describe('agentPresence', () => {
  it('reports "none" when no agent is a member', () => {
    expect(agentPresence([])).toBe('none');
  });

  it('reports "offline" when agents are members but none are online', () => {
    // A connected-but-offline agent (e.g. a local/TUI agent whose heartbeat
    // went stale) must NOT be treated as "no agents".
    expect(agentPresence([{ status: 'offline' }])).toBe('offline');
    expect(
      agentPresence([{ status: 'offline' }, { status: 'reconnecting' }]),
    ).toBe('offline');
  });

  it('reports "online" when at least one agent is online', () => {
    expect(agentPresence([{ status: 'online' }])).toBe('online');
    expect(
      agentPresence([{ status: 'offline' }, { status: 'online' }]),
    ).toBe('online');
  });
});

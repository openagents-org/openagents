import { describe, expect, it } from 'vitest';
import {
  agentAvailability,
  availabilityLabel,
  apiErrorStatus,
  canClaimAgent,
  canManageAgent,
  costOwnerDescriptor,
  displayNameFromEmail,
  linesToList,
  sortDirectory,
} from './collab';

describe('agentAvailability', () => {
  it('prefers a pending approval over everything', () => {
    expect(agentAvailability({ status: 'online' }, 2)).toBe('waiting');
    expect(agentAvailability({ status: 'offline', runtimeStatus: 'offline' }, 1)).toBe('waiting');
    expect(agentAvailability({ status: 'online', presenceState: 'waiting' })).toBe('waiting');
  });

  it('tells a dead device apart from a quiet agent', () => {
    expect(agentAvailability({ status: 'offline', runtimeStatus: 'offline' })).toBe('device_offline');
    expect(agentAvailability({ status: 'offline', runtimeStatus: 'online' })).toBe('offline');
    expect(agentAvailability({ status: 'offline', runtimeStatus: null })).toBe('offline');
  });

  it('reports busy from presence, queue depth or busy channels', () => {
    expect(agentAvailability({ status: 'online', presenceState: 'busy' })).toBe('busy');
    expect(agentAvailability({ status: 'online', queueDepth: 3 })).toBe('busy');
    expect(agentAvailability({ status: 'online', busyChannels: ['c1'] })).toBe('busy');
    expect(agentAvailability({ status: 'online', queueDepth: 0, busyChannels: [] })).toBe('online');
  });
});

describe('availabilityLabel', () => {
  // A stand-in translator: returns the key plus any params, so the test checks
  // the key mapping and not the English copy.
  const t = ((key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key) as unknown as Parameters<typeof availabilityLabel>[0];

  it('maps every availability onto its collab.* key', () => {
    expect(availabilityLabel(t, 'online')).toBe('collab.online');
    expect(availabilityLabel(t, 'busy')).toBe('collab.busy');
    expect(availabilityLabel(t, 'busy', 3)).toBe('collab.busyQueued:{"count":3}');
    expect(availabilityLabel(t, 'waiting')).toBe('collab.waiting');
    expect(availabilityLabel(t, 'device_offline')).toBe('collab.deviceOffline');
    expect(availabilityLabel(t, 'offline')).toBe('collab.agentOffline');
  });
});

describe('costOwnerDescriptor', () => {
  it('honours an explicit declaration', () => {
    expect(costOwnerDescriptor('workspace', 'a@x.com', null, 'b@x.com')).toEqual({ kind: 'workspace' });
    expect(costOwnerDescriptor('requester', 'a@x.com', null, 'b@x.com')).toEqual({ kind: 'yours' });
  });

  it("defaults to the owner's credits, which are yours when you own it", () => {
    expect(costOwnerDescriptor(null, 'Owner@X.com', 'Owner Name', 'owner@x.com')).toEqual({ kind: 'yours' });
    expect(costOwnerDescriptor('owner', 'owner@x.com', 'Owner Name', 'me@x.com')).toEqual({ kind: 'owner', owner: 'Owner Name' });
    expect(costOwnerDescriptor('owner', 'owner@x.com', null, 'me@x.com')).toEqual({ kind: 'owner', owner: 'owner' });
  });

  it('falls back to workspace credits for an unowned agent', () => {
    expect(costOwnerDescriptor(null, null, null, 'me@x.com')).toEqual({ kind: 'workspace' });
  });
});

describe('permissions', () => {
  it('lets admins and the owner manage, nobody else', () => {
    expect(canManageAgent({ email: 'a@x.com', effectiveRole: 'admin' }, 'b@x.com')).toBe(true);
    expect(canManageAgent({ email: 'b@x.com', effectiveRole: 'member' }, 'B@x.com')).toBe(true);
    expect(canManageAgent({ email: 'c@x.com', effectiveRole: 'member' }, 'b@x.com')).toBe(false);
    expect(canManageAgent(null, 'b@x.com')).toBe(false);
  });

  it('allows claiming only unowned agents', () => {
    expect(canClaimAgent({ email: 'a@x.com' }, null)).toBe(true);
    expect(canClaimAgent({ email: 'a@x.com' }, '')).toBe(true);
    expect(canClaimAgent({ email: 'a@x.com' }, 'b@x.com')).toBe(false);
    expect(canClaimAgent({ email: null }, null)).toBe(false);
  });
});

describe('small helpers', () => {
  it('extracts the status from WorkspaceApi errors', () => {
    expect(apiErrorStatus(new Error('API 403: {"message":"nope"}'))).toBe(403);
    expect(apiErrorStatus(new Error('boom'))).toBeNull();
    expect(apiErrorStatus(undefined)).toBeNull();
  });

  it('derives a display name from an email', () => {
    expect(displayNameFromEmail('jane.doe@x.com')).toBe('jane.doe');
    expect(displayNameFromEmail('Jane')).toBe('Jane');
    expect(displayNameFromEmail(null)).toBe('');
  });

  it('splits textarea lines', () => {
    expect(linesToList(' a \n\nb\r\n c')).toEqual(['a', 'b', 'c']);
  });

  it('sorts pinned, then available, then by name', () => {
    const rows = [
      { agent_name: 'zed', display_name: null, pinned: false, status: 'online' },
      { agent_name: 'amy', display_name: null, pinned: false, status: 'offline' },
      { agent_name: 'bob', display_name: 'Bob', pinned: true, status: 'offline', runtimeStatus: 'offline' as const },
      { agent_name: 'cat', display_name: null, pinned: false, status: 'online', queueDepth: 2 },
    ];
    expect(sortDirectory(rows).map((r) => r.agent_name)).toEqual(['bob', 'zed', 'cat', 'amy']);
  });
});

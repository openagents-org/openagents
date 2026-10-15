import { describe, expect, it } from 'vitest';
import {
  signalVersionKey,
  diffNewSignals,
  groupSignals,
  shouldNotify,
  shouldShowNotificationPrompt,
  signalKind,
  withoutLocallyRead,
} from './signals';
import type { NotificationItem } from './types';

let seq = 0;
function sig(overrides: Partial<NotificationItem> = {}): NotificationItem {
  seq += 1;
  return {
    id: `n${seq}`,
    title: 'Sam Okafor sent you a message',
    message: 'hey',
    priority: 'normal',
    isRead: false,
    createdBy: 'human:sam@acme.test',
    channelName: 'dm:human:mia@acme.test,human:sam@acme.test',
    threadId: null,
    linkUrl: null,
    status: 'active',
    kind: 'dm',
    actionRef: null,
    recipientEmail: 'mia@acme.test',
    createdAt: `2026-10-10T10:00:${String(seq % 60).padStart(2, '0')}Z`,
    readAt: null,
    ...overrides,
  };
}

describe('signalKind', () => {
  it('recognises dm and mention only', () => {
    expect(signalKind({ kind: 'dm' })).toBe('dm');
    expect(signalKind({ kind: 'mention' })).toBe('mention');
    expect(signalKind({ kind: 'approval' })).toBeNull();
    expect(signalKind({ kind: null })).toBeNull();
  });
});

describe('groupSignals', () => {
  it('counts mentions and dms per channel and keeps the newest', () => {
    const a = sig({ kind: 'mention', channelName: 'release-2.4', createdAt: '2026-10-10T10:00:00Z' });
    const b = sig({ kind: 'mention', channelName: 'release-2.4', createdAt: '2026-10-10T11:00:00Z' });
    const d = sig();
    const grouped = groupSignals([a, b, d]);
    expect(grouped['release-2.4']).toEqual({ mentions: 2, dms: 0, latest: b });
    expect(grouped[d.channelName!]).toMatchObject({ mentions: 0, dms: 1, latest: d });
  });

  it('skips read rows, rows without a channel and other kinds', () => {
    const grouped = groupSignals([
      sig({ isRead: true }),
      sig({ channelName: null }),
      sig({ kind: 'approval', channelName: 'x' }),
    ]);
    expect(grouped).toEqual({});
  });
});

describe('withoutLocallyRead', () => {
  it('drops ids already marked read in this browser', () => {
    const a = sig();
    const b = sig();
    expect(withoutLocallyRead([a, b], new Set([a.id]))).toEqual([b]);
  });
});

describe('diffNewSignals', () => {
  it('baselines on the first poll without reporting anything new', () => {
    const a = sig();
    const { fresh, seen } = diffNewSignals(null, [a]);
    expect(fresh).toEqual([]);
    expect(seen.has(signalVersionKey(a))).toBe(true);
  });

  it('reports only ids not seen before, and does not mutate its input', () => {
    const a = sig();
    const b = sig();
    const first = diffNewSignals(null, [a]);
    const second = diffNewSignals(first.seen, [a, b]);
    expect(second.fresh).toEqual([b]);
    expect(first.seen.has(signalVersionKey(b))).toBe(false);
    expect(diffNewSignals(second.seen, [a, b]).fresh).toEqual([]);
  });

  it('treats an empty first poll as a baseline too', () => {
    const first = diffNewSignals(null, []);
    const a = sig();
    expect(diffNewSignals(first.seen, [a]).fresh).toEqual([a]);
  });
});

describe('shouldNotify', () => {
  const s = sig({ channelName: 'release-2.4' });
  it('notifies when the window is hidden or unfocused, even for the open thread', () => {
    expect(shouldNotify(s, { hidden: true, focused: false, openSessionId: 'release-2.4' })).toBe(true);
    expect(shouldNotify(s, { hidden: false, focused: false, openSessionId: 'release-2.4' })).toBe(true);
  });
  it('notifies for another conversation while focused', () => {
    expect(shouldNotify(s, { hidden: false, focused: true, openSessionId: 'other' })).toBe(true);
    expect(shouldNotify(s, { hidden: false, focused: true, openSessionId: null })).toBe(true);
  });
  it('stays quiet for the conversation the user is looking at', () => {
    expect(shouldNotify(s, { hidden: false, focused: true, openSessionId: 'release-2.4' })).toBe(false);
  });
});

describe('shouldShowNotificationPrompt', () => {
  const base = { supported: true, permission: 'default', dismissed: false, triggered: true };
  it('shows once triggered while permission is undecided', () => {
    expect(shouldShowNotificationPrompt(base)).toBe(true);
  });
  it('hides when unsupported, decided, dismissed or not yet triggered', () => {
    expect(shouldShowNotificationPrompt({ ...base, supported: false, permission: null })).toBe(false);
    expect(shouldShowNotificationPrompt({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldShowNotificationPrompt({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldShowNotificationPrompt({ ...base, dismissed: true })).toBe(false);
    expect(shouldShowNotificationPrompt({ ...base, triggered: false })).toBe(false);
  });
});


describe('diffNewSignals — burst collapse', () => {
  it('treats a refreshed row (same id, newer createdAt) as new', () => {
    const base = { id: 'n1', kind: 'dm', channelName: 'dm:a,b', title: 'x', message: 'one', createdAt: '2026-10-10T10:00:00Z' } as any;
    const first = diffNewSignals(null, [base]);
    expect(first.fresh).toHaveLength(0);
    const again = diffNewSignals(first.seen, [base]);
    expect(again.fresh).toHaveLength(0);
    const refreshed = { ...base, message: 'two', createdAt: '2026-10-10T10:01:00Z' };
    const third = diffNewSignals(again.seen, [refreshed]);
    expect(third.fresh.map((n: any) => n.message)).toEqual(['two']);
  });
});

import { describe, expect, it } from 'vitest';
import type { BrowserPersistentContext, BrowserTab } from '@/lib/types';
import { buildTabEntries, displayUrl, hostOf, idleMinutesLeft, normalizeUrl } from './tab-model';
import { knownAction, tabHasFreshAgentActivity } from './agent-activity';

const tab = (over: Partial<BrowserTab>): BrowserTab => ({
  id: 't1', url: 'https://www.example.com/a?b=1', title: 'Example', status: 'active',
  createdBy: 'human:user', sharedWith: [], liveUrl: null, sessionId: null,
  contextId: null, contextName: null, kind: 'temporary', activity: null,
  createdAt: null, lastActiveAt: null, ...over,
});
const ctx = (over: Partial<BrowserPersistentContext>): BrowserPersistentContext => ({
  id: 'c1', name: 'LinkedIn', domain: 'linkedin.com', status: 'active', createdBy: 'human:user',
  sharedWith: [], createdAt: null, lastUsedAt: null, ...over,
});

describe('buildTabEntries', () => {
  it('lists every permanent tab (awake or asleep) before any temporary tab', () => {
    const awake = tab({ id: 'live', contextId: 'c1', kind: 'permanent' });
    const temp = tab({ id: 'tmp' });
    const { permanent, temporary } = buildTabEntries([temp, awake], [ctx({ id: 'c1' }), ctx({ id: 'c2', name: 'GitHub' })]);
    expect(permanent.map((e) => [e.context.name, !!e.tab])).toEqual([['LinkedIn', true], ['GitHub', false]]);
    expect(temporary.map((e) => e.tab.id)).toEqual(['tmp']);
  });

  it('keeps a live tab whose context row is missing as a permanent entry', () => {
    const orphan = tab({ id: 'live', contextId: 'gone', contextName: 'Old login', kind: 'permanent' });
    const { permanent, temporary } = buildTabEntries([orphan], []);
    expect(permanent).toHaveLength(1);
    expect(permanent[0].context.name).toBe('Old login');
    expect(permanent[0].tab?.id).toBe('live');
    expect(temporary).toHaveLength(0);
  });
});

describe('url helpers', () => {
  it('normalizes bare hosts to https and leaves schemes alone', () => {
    expect(normalizeUrl('  ')).toBe('about:blank');
    expect(normalizeUrl('example.com/x')).toBe('https://example.com/x');
    expect(normalizeUrl('http://a.b')).toBe('http://a.b');
    expect(normalizeUrl('about:blank')).toBe('about:blank');
  });
  it('shows a compact host + path and drops www.', () => {
    expect(hostOf('https://www.linkedin.com/feed')).toBe('linkedin.com');
    expect(displayUrl('https://www.example.com/a?b=1')).toBe('www.example.com/a?b=1');
    expect(displayUrl('https://example.com/' + 'x'.repeat(100), 20).endsWith('…')).toBe(true);
  });
});

describe('idle + activity', () => {
  it('counts down the idle sweeper and floors at zero', () => {
    const now = Date.parse('2026-01-01T00:40:00Z');
    expect(idleMinutesLeft(tab({ lastActiveAt: '2026-01-01T00:30:00Z' }), 30, now)).toBe(20);
    expect(idleMinutesLeft(tab({ lastActiveAt: '2025-12-31T00:00:00Z' }), 30, now)).toBe(0);
    expect(idleMinutesLeft(tab({ lastActiveAt: null }), 30, now)).toBe(30);
  });
  it('treats only recent agent actions as live activity', () => {
    const now = Date.parse('2026-01-01T00:00:10Z');
    const fresh = tab({ activity: { action: 'click', actor: 'openagents:scout', at: '2026-01-01T00:00:05Z' } });
    const stale = tab({ activity: { action: 'click', actor: 'openagents:scout', at: '2026-01-01T00:00:00Z' } });
    const human = tab({ activity: { action: 'navigate', actor: 'human:user', at: '2026-01-01T00:00:09Z' } });
    expect(tabHasFreshAgentActivity(fresh, now)).toBe(true);
    expect(tabHasFreshAgentActivity(stale, now + 20_000)).toBe(false);
    expect(tabHasFreshAgentActivity(human, now)).toBe(false);
  });
  it('maps unknown actions to a generic label key', () => {
    expect(knownAction('click')).toBe('click');
    expect(knownAction('solve_captcha')).toBe('other');
    expect(knownAction(null)).toBe('other');
  });
});

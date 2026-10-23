import { describe, expect, it } from 'vitest';
import en from './i18n/messages/en-US';
import { messages as zh } from './i18n/messages/zh-CN';
import { translate, type TranslateParams } from './i18n/translate';
import type { TranslateFn } from './i18n';
import {
  expiryPresetToIso,
  findEveryoneGroup,
  legacyUsableBy,
  ownerDisplay,
  usabilitySummary,
  visibilityBadgeFor,
  visibilityBadgeLabel,
  visibilityBadgeLabelKey,
} from './artifact-access';

/** Real English copy, so plural forms and wording are what the UI shows. */
const tEn = ((key: string, params?: TranslateParams) => translate(en, en, 'en-US', key, params)) as unknown as TranslateFn;
const tZh = ((key: string, params?: TranslateParams) => translate(zh, en, 'zh-CN', key, params)) as unknown as TranslateFn;

describe('visibilityBadgeFor / label', () => {
  it('shows the explicit value when set', () => {
    expect(visibilityBadgeFor('file', 'private')).toBe('private');
    expect(visibilityBadgeFor('knowledge', 'public')).toBe('public');
    expect(visibilityBadgeLabel(tEn, 'private')).toBe('Private');
    expect(visibilityBadgeLabel(tEn, 'public')).toBe('Public');
  });

  it('a file without a visibility inherits from its thread', () => {
    expect(visibilityBadgeFor('file', null)).toBe('inherit');
    expect(visibilityBadgeFor('file', undefined)).toBe('inherit');
    expect(visibilityBadgeLabelKey('inherit')).toBe('artifactAccess.inherits');
    expect(visibilityBadgeLabel(tEn, 'inherit')).toBe('Inherits thread');
    // When the backend resolved it, the badge says what it resolved to.
    expect(visibilityBadgeLabel(tEn, 'inherit', 'public')).toBe('Inherits thread · Public');
    expect(visibilityBadgeLabel(tZh, 'inherit', 'private')).toBe('跟随会话 · 私有');
  });

  it('knowledge has no thread: a missing value is the legacy public backfill', () => {
    expect(visibilityBadgeFor('knowledge', null)).toBe('public');
    expect(visibilityBadgeFor('knowledge', null, 'private')).toBe('private');
  });
});

describe('ownerDisplay', () => {
  it('parses a human owner from the "human:" prefix', () => {
    const d = ownerDisplay('human:jane.doe@acme.com');
    expect(d.kind).toBe('human');
    expect(d.id).toBe('jane.doe@acme.com');
    expect(d.label).toBe('jane.doe');
  });

  it('parses an agent owner from the "openagents:" prefix', () => {
    const d = ownerDisplay('openagents:yumi');
    expect(d).toEqual({ kind: 'agent', id: 'yumi', label: 'yumi' });
  });

  it('prefers the backend label and tolerates no owner', () => {
    expect(ownerDisplay('human:jane.doe@acme.com', 'Jane Doe').label).toBe('Jane Doe');
    expect(ownerDisplay(null)).toEqual({ kind: null, id: null, label: '' });
    expect(ownerDisplay('something-else').kind).toBeNull();
  });
});

describe('usabilitySummary', () => {
  it('is "Everyone" when the everyone grant is on, whatever else exists', () => {
    expect(usabilitySummary(tEn, { everyone: true, groups: [{ id: 'g', name: 'Ops' }], people: 4, agents: 1 })).toBe('Everyone');
    expect(usabilitySummary(tZh, { everyone: true, groups: [], people: 0, agents: 0 })).toBe('所有人');
  });

  it('tallies groups, people and agents with plurals', () => {
    expect(usabilitySummary(tEn, { everyone: false, groups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], people: 2, agents: 0 }))
      .toBe('3 groups · 2 people');
    expect(usabilitySummary(tEn, { everyone: false, groups: [{ id: 'a', name: 'A' }], people: 1, agents: 1 }))
      .toBe('1 group · 1 person · 1 agent');
  });

  it('falls back to "Only owner" with no grants, and to empty when unknown', () => {
    expect(usabilitySummary(tEn, { everyone: false, groups: [], people: 0, agents: 0 })).toBe('Only owner');
    expect(usabilitySummary(tEn, null)).toBe('');
    expect(usabilitySummary(tEn, undefined)).toBe('');
  });

  it('folds the deprecated personal/team flag into the same shape', () => {
    expect(usabilitySummary(tEn, legacyUsableBy('team', 0))).toBe('Everyone');
    expect(usabilitySummary(tEn, legacyUsableBy(undefined, 0))).toBe('Everyone');
    expect(usabilitySummary(tEn, legacyUsableBy('personal', 3))).toBe('3 people');
    expect(usabilitySummary(tEn, legacyUsableBy('personal', 0))).toBe('Only owner');
  });
});

describe('expiry presets and the everyone group', () => {
  it('turns a preset into an ISO date relative to now', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    expect(expiryPresetToIso('never', now)).toBeUndefined();
    expect(expiryPresetToIso('7d', now)).toBe('2026-10-10T00:00:00.000Z');
    expect(expiryPresetToIso('30d', now)).toBe('2026-11-02T00:00:00.000Z');
  });

  it('finds the builtin everyone group by kind, then by slug', () => {
    expect(findEveryoneGroup([{ kind: 'custom', slug: 'ops' }, { kind: 'everyone', slug: 'all' }])?.slug).toBe('all');
    expect(findEveryoneGroup([{ kind: 'custom', slug: 'everyone' }])?.slug).toBe('everyone');
    expect(findEveryoneGroup([{ kind: 'guest', slug: 'guest' }])).toBeUndefined();
  });
});

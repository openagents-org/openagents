/**
 * Permission model v1.1 — pure helpers for owned artifacts (files, knowledge)
 * and agent usability. No React, no API: the components lean on these so the
 * wording rules live in one place and are unit-testable.
 */

import { displayNameFromEmail } from './collab';
import type { MessageKey, TranslateFn } from './i18n';
import type { AgentUsableBy, AgentVisibility, ArtifactVisibility } from './types';

export type ArtifactKind = 'file' | 'knowledge';

/** The three visibility states an artifact badge can show. Files with no
 * explicit visibility inherit from their thread; knowledge has no thread so a
 * missing value is the legacy "public" backfill. */
export type VisibilityBadge = 'private' | 'public' | 'inherit';

export function visibilityBadgeFor(
  kind: ArtifactKind,
  visibility: ArtifactVisibility | null | undefined,
  effectiveVisibility?: ArtifactVisibility | null,
): VisibilityBadge {
  if (visibility === 'private' || visibility === 'public') return visibility;
  if (kind === 'file') return 'inherit';
  return effectiveVisibility ?? 'public';
}

export function visibilityBadgeLabelKey(badge: VisibilityBadge): MessageKey {
  switch (badge) {
    case 'private':
      return 'artifactAccess.private';
    case 'public':
      return 'artifactAccess.public';
    default:
      return 'artifactAccess.inherits';
  }
}

export function visibilityBadgeLabel(t: TranslateFn, badge: VisibilityBadge, effective?: ArtifactVisibility | null): string {
  const label = t(visibilityBadgeLabelKey(badge));
  if (badge === 'inherit' && effective) {
    return `${label} · ${t(visibilityBadgeLabelKey(effective))}`;
  }
  return label;
}

/** Who owns an artifact, parsed from the "human:<email>" / "openagents:<agent>"
 * owner string. `ownerLabel` from the backend wins when present. */
export interface OwnerDisplay {
  kind: 'human' | 'agent' | null;
  /** Bare id without the prefix: the email or the agent name. */
  id: string | null;
  label: string;
}

export function ownerDisplay(owner: string | null | undefined, ownerLabel?: string | null): OwnerDisplay {
  if (!owner) return { kind: null, id: null, label: ownerLabel || '' };
  const human = owner.match(/^human:(.+)$/);
  if (human) {
    const id = human[1];
    return { kind: 'human', id, label: ownerLabel || displayNameFromEmail(id) };
  }
  const agent = owner.match(/^(?:openagents|agent):(.+)$/);
  if (agent) {
    const id = agent[1];
    return { kind: 'agent', id, label: ownerLabel || id };
  }
  return { kind: null, id: owner, label: ownerLabel || owner };
}

/** One line for the directory card / profile: "Everyone", "3 groups · 2 people",
 * "Only owner". Tolerates a backend that does not send `usable_by` yet. */
export function usabilitySummary(t: TranslateFn, usableBy: AgentUsableBy | null | undefined): string {
  if (!usableBy) return '';
  if (usableBy.everyone) return t('agentAccess.everyone');
  const parts: string[] = [];
  const groups = usableBy.groups?.length ?? 0;
  if (groups > 0) parts.push(t('agentAccess.summaryGroups', { count: groups }));
  if (usableBy.people > 0) parts.push(t('agentAccess.summaryPeople', { count: usableBy.people }));
  if (usableBy.agents > 0) parts.push(t('agentAccess.summaryAgents', { count: usableBy.agents }));
  return parts.length > 0 ? parts.join(' · ') : t('agentAccess.onlyOwner');
}

/** Older backends send only the deprecated personal/team flag + a grant count.
 * Fold that into the `usable_by` shape so one summary function serves both. */
export function legacyUsableBy(visibility: AgentVisibility | null | undefined, grantCount = 0): AgentUsableBy {
  return {
    everyone: visibility !== 'personal',
    groups: [],
    people: Math.max(0, grantCount),
    agents: 0,
  };
}

/** Grant expiry presets offered in the "Who can use this agent" section. */
export type ExpiryPreset = 'never' | '7d' | '30d' | '90d';

export const EXPIRY_PRESETS: ExpiryPreset[] = ['never', '7d', '30d', '90d'];

export function expiryPresetToIso(preset: ExpiryPreset, now: Date = new Date()): string | undefined {
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : 0;
  if (!days) return undefined;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** The builtin "everyone" group from a /groups listing, if the backend has
 * created it for this workspace. */
export function findEveryoneGroup<G extends { kind: string; slug?: string }>(groups: G[]): G | undefined {
  return groups.find((g) => g.kind === 'everyone') ?? groups.find((g) => g.slug === 'everyone');
}

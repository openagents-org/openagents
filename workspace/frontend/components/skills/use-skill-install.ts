'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import type { Skill } from './skill-types';
import { extractErrorMessage } from './skill-utils';

export type SkillInstallState = 'installing' | 'installed' | 'failed' | null;

/** Past this an "installing" report has stalled; offer a retry instead of a spinner. */
const STALE_INSTALL_MS = 2 * 60 * 1000;

/** Mirrored registry packages only run on agents that read the Agent Skills format. */
const MIRRORED_AGENT_TYPES = ['claude', 'claude-code', 'cursor', 'codex'];

/**
 * Install/remove one skill on the workspace's online agents, and each agent's
 * install state as its launcher reports it.
 */
export function useSkillInstall(skill: Skill) {
  const { agents, refreshWorkspace } = useWorkspace();
  const t = useT();
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const isRegistry = skill.sourceType === 'registry';

  const install = useCallback(async (agentName: string) => {
    setPendingAgent(agentName);
    try {
      await workspaceApi.installSkill(agentName, skill.installId || skill.id, skill.versionId);
      // The request only queues the install; the launcher installs the skill
      // and reports back. Server `skill_status` (installing → installed/failed)
      // drives the badge from here, picked up by discovery polling.
      await refreshWorkspace();
      toast.success(t('skills.installStarted', { skill: skill.name, agent: agentName }));
    } catch (e) {
      // Surface the backend message — e.g. a custom skill whose uploaded file
      // was deleted returns "…please re-upload the skill." rather than a
      // generic failure the user can't act on.
      toast.error(extractErrorMessage(e) || t('skills.installFailed'));
    } finally {
      setPendingAgent(null);
    }
  }, [skill, refreshWorkspace, t]);

  const uninstall = useCallback(async (agentName: string) => {
    setPendingAgent(agentName);
    try {
      await workspaceApi.uninstallSkill(agentName, skill.installId || skill.id);
      await refreshWorkspace();
      toast.success(t('skills.removed', { skill: skill.name, agent: agentName }));
    } catch {
      toast.error(t('skills.removeFailed'));
    } finally {
      setPendingAgent(null);
    }
  }, [skill, refreshWorkspace, t]);

  // Resolve the install state for this skill on a given agent. Prefer the
  // richer skill_status map (installing/installed/failed) the launcher reports
  // back; fall back to the legacy `installed` list for older backends.
  const stateFor = (agentName: string): SkillInstallState => {
    // Optimistic local state wins until the next discovery refresh confirms
    // the launcher's reported status.
    if (pendingAgent === agentName) return 'installing';
    const agent = agents.find(a => a.agentName === agentName);
    const skills = (agent?.enabledSkills as Record<string, unknown>) || {};
    const statusMap = (skills.skill_status as Record<string, { state?: string; updated_at?: number }>) || {};
    // Registry UUIDs were briefly used for upstream catalog state. Read both
    // keys so users on that build can still see and remove their installation;
    // all new upstream actions use the historical catalog slug.
    const stateKeys = Array.from(new Set([skill.installId || skill.id, skill.id]));
    const entry = stateKeys
      .map(key => statusMap[key])
      .filter((candidate): candidate is { state?: string; updated_at?: number } => Boolean(candidate))
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
    if (entry?.state === 'installing') {
      return entry.updated_at && Date.now() - entry.updated_at > STALE_INSTALL_MS ? 'failed' : 'installing';
    }
    if (entry?.state === 'failed' || entry?.state === 'installed') return entry.state;
    const installed = (skills.installed as string[]) || [];
    return stateKeys.some(key => installed.includes(key)) ? 'installed' : null;
  };

  const onlineAgents = agents.filter(a => {
    if (a.status !== 'online') return false;
    if (!isRegistry || skill.sourceMode === 'upstream_pointer') return true;
    return MIRRORED_AGENT_TYPES.includes((a.agentType || '').toLowerCase());
  });

  return { onlineAgents, stateFor, install, uninstall };
}

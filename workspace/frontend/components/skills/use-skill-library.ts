'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceCustomSkill } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { SKILLS } from './skill-catalog';
import type { Skill } from './skill-types';
import { customSkillToSkill, registrySkillToSkill } from './skill-utils';

/** The Registry ranks its first results as featured. */
const FEATURED_COUNT = 4;

/**
 * Every skill the hub can show: the Registry's search results (or the static
 * catalogue on backends without one) plus this workspace's uploaded skills.
 */
/** The workspace's uploaded skills, as cards. */
const fetchCustomSkills = async () => (await workspaceApi.getCustomSkills()).map(customSkillToSkill);

/** Registry search results, as cards; the first few are featured. */
const fetchRegistrySkills = async (search: string, category: string) =>
  (await workspaceApi.getRegistrySkills(search, category)).map((skill, index) =>
    registrySkillToSkill(skill, index < FEATURED_COUNT));

export function useSkillLibrary(search: string, category: string) {
  const { workspace } = useWorkspace();
  const [customSkills, setCustomSkills] = useState<Skill[]>([]);
  const [registrySkills, setRegistrySkills] = useState<Skill[] | null>(null);
  const [registryAvailable, setRegistryAvailable] = useState<boolean | null>(null);

  // Load this workspace's custom skills once the workspace (and hence the
  // configured API client) is ready.
  const workspaceId = workspace?.workspaceId;
  const reloadCustomSkills = useCallback(async () => {
    if (!workspaceId) return;
    setCustomSkills(await fetchCustomSkills());
  }, [workspaceId]);

  const reloadRegistrySkills = useCallback(async () => {
    setRegistrySkills(await fetchRegistrySkills(search, category));
    setRegistryAvailable(true);
  }, [search, category]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetchCustomSkills()
      .then(list => { if (!cancelled) setCustomSkills(list); })
      .catch(() => { /* non-fatal: just show the catalog */ });
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchRegistrySkills(search, category)
        .then(list => {
          if (!cancelled) {
            setRegistrySkills(list);
            setRegistryAvailable(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRegistrySkills(null);
            setRegistryAvailable(false);
          }
        });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search, category]);

  /** Put a freshly uploaded skill at the front without waiting for a reload. */
  const addUploaded = useCallback((created: WorkspaceCustomSkill) => {
    const skill = customSkillToSkill(created);
    setCustomSkills(prev => [skill, ...prev.filter(s => s.id !== skill.id)]);
  }, []);

  // The static catalogue remains a compatibility fallback while older backend
  // deployments roll forward. New deployments use the Registry as the source
  // of truth, avoiding a fourth hard-coded copy of the catalogue.
  const allSkills = useMemo(
    () => [...(registryAvailable === true ? (registrySkills || []) : SKILLS), ...customSkills],
    [registryAvailable, registrySkills, customSkills],
  );

  return { allSkills, customSkills, reloadCustomSkills, reloadRegistrySkills, addUploaded };
}

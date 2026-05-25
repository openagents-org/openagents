'use strict';

/**
 * Skill Hub catalog — JavaScript mirror of the backend skill_catalog.py.
 *
 * Provides the same skill definitions and conversion helpers so the
 * launcher CLI and daemon can work offline without hitting the backend.
 */

const SKILL_CATALOG = [
  {
    id: 'workspace-core',
    name: 'Workspace Core',
    description: 'Messaging, agent discovery, and status — always available',
    category: 'core',
    icon: 'message-square',
    moduleKey: null,
    defaultEnabled: true,
    toggleable: false,
  },
  {
    id: 'files',
    name: 'Shared Files',
    description: 'Upload, download, and share files across workspace agents and users',
    category: 'collaboration',
    icon: 'file-text',
    moduleKey: 'files',
    defaultEnabled: true,
    toggleable: true,
  },
  {
    id: 'browser',
    name: 'Shared Browser',
    description: 'Browse websites through the workspace\'s shared browser session',
    category: 'collaboration',
    icon: 'globe',
    moduleKey: 'browser',
    defaultEnabled: true,
    toggleable: true,
  },
  {
    id: 'tunnel',
    name: 'Cloudflare Tunnel',
    description: 'Expose local services to the internet via secure tunnels',
    category: 'collaboration',
    icon: 'cloud',
    moduleKey: 'tunnel',
    defaultEnabled: true,
    toggleable: true,
  },
  {
    id: 'todos',
    name: 'Task Planning',
    description: 'Create and manage to-do lists for coordinated agent work',
    category: 'productivity',
    icon: 'check-square',
    moduleKey: 'todos',
    defaultEnabled: true,
    toggleable: true,
  },
  {
    id: 'timers',
    name: 'Timers',
    description: 'Set countdown timers with callback messages',
    category: 'productivity',
    icon: 'timer',
    moduleKey: 'timers',
    defaultEnabled: true,
    toggleable: true,
  },
  {
    id: 'routines',
    name: 'Routines',
    description: 'Schedule recurring tasks on a daily or interval basis',
    category: 'productivity',
    icon: 'repeat',
    moduleKey: 'routines',
    defaultEnabled: true,
    toggleable: true,
  },
];

const _TOGGLEABLE = SKILL_CATALOG.filter(s => s.toggleable);

/**
 * Convert a per-agent skills config object to a disabledModules Set.
 *
 * @param {Object.<string, boolean>|null|undefined} skills
 * @returns {Set<string>}
 */
function skillsToDisabledModules(skills) {
  if (!skills || typeof skills !== 'object') return new Set();

  const disabled = new Set();
  for (const s of _TOGGLEABLE) {
    const enabled = skills[s.id] !== undefined ? skills[s.id] : s.defaultEnabled;
    if (!enabled && s.moduleKey) {
      disabled.add(s.moduleKey);
    }
  }
  return disabled;
}

/**
 * Return default skill state: {id: defaultEnabled} for all toggleable skills.
 */
function getSkillDefaults() {
  const defaults = {};
  for (const s of _TOGGLEABLE) {
    defaults[s.id] = s.defaultEnabled;
  }
  return defaults;
}

module.exports = { SKILL_CATALOG, skillsToDisabledModules, getSkillDefaults };

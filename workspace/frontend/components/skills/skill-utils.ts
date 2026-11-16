import type { MessageKey, TranslateFn } from '@/lib/i18n';
import type { RegistrySkill, WorkspaceCustomSkill } from '@/lib/types';
import { findBuiltinSkill } from './skill-catalog';
import type { Skill } from './skill-types';

export const CUSTOM_SKILL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Map a backend custom skill into the local Skill shape used by the UI. */
export function customSkillToSkill(c: WorkspaceCustomSkill): Skill {
  return {
    id: c.id,
    name: c.name,
    description: c.description || '',
    category: 'custom',
    tags: c.tags || [],
    author: c.author || 'Workspace user',
    sourceType: 'workspace_file',
    fileId: c.fileId,
    filename: c.filename,
    contentType: c.contentType,
    packageType: c.packageType,
    workspaceSkillId: c.workspaceSkillId,
    registrySkillId: c.registrySkillId,
    version: c.version,
    versionId: c.versionId,
    forkedFromVersionId: c.forkedFromVersionId,
    unavailable: c.unavailable,
    visibility: c.publicVisibility,
  };
}

export function registrySkillToSkill(skill: RegistrySkill, featured = false): Skill {
  const latest = skill.latestVersion || undefined;
  const builtin = latest?.sourceMode === 'upstream_pointer' ? findBuiltinSkill(skill.slug) : undefined;
  return {
    id: skill.id,
    installId: builtin?.id || (latest?.sourceMode === 'upstream_pointer' ? skill.slug : skill.id),
    name: skill.name,
    description: skill.summary || skill.description || '',
    category: skill.category || 'custom',
    tags: skill.tags?.length ? skill.tags : (builtin?.tags || []),
    logo: builtin?.logo,
    author: skill.namespaceName || skill.namespace,
    featured: builtin?.featured ?? featured,
    sourceType: 'registry',
    sourceRepo: latest?.sourceRepo || builtin?.sourceRepo,
    sourcePath: latest?.sourcePath || builtin?.sourcePath,
    packageType: latest?.packageType,
    registrySkillId: skill.id,
    slug: skill.slug,
    namespace: skill.namespace,
    namespaceName: skill.namespaceName,
    version: latest?.version,
    versionId: latest?.id,
    sourceMode: latest?.sourceMode,
    license: latest?.license,
    forkedFromVersionId: skill.forkedFromVersionId,
    installCount: skill.installCount,
    visibility: skill.visibility,
  };
}

export function deriveSkillId(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  return (
    stem.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 64) ||
    'custom-skill'
  );
}

/** Pull the human-readable message out of an API error like `API 400: {json}`. */
export function extractErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const brace = msg.indexOf('{');
  if (brace >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(brace));
      if (parsed && typeof parsed.message === 'string') return parsed.message;
    } catch {
      /* fall through */
    }
  }
  return msg;
}

export const CATEGORIES = [
  { id: 'all', icon: '🔥' },
  { id: 'ai-ml', icon: '🧠' },
  { id: 'frontend', icon: '🎨' },
  { id: 'backend', icon: '⚙️' },
  { id: 'database', icon: '🗄️' },
  { id: 'devops', icon: '🚀' },
  { id: 'testing', icon: '🧪' },
  { id: 'security', icon: '🔒' },
  { id: 'integrations', icon: '🔗' },
  { id: 'documents', icon: '📄' },
  { id: 'sensenova', icon: '🌟' },
  { id: 'custom', icon: '📦' },
] as const;

/** Label for a category id, e.g. `ai-ml` → "AI & ML" / "AI 与机器学习". */
export function categoryLabel(t: TranslateFn, id: string): string {
  return t(`skills.categories.${id}` as MessageKey);
}

/**
 * A skill's description in the active language.
 *
 * Uploaded skills keep whatever the uploader typed; catalogue skills read from
 * `skills.catalog.<id>`, which is why the SKILLS array carries no prose.
 */
export function skillDescription(t: TranslateFn, skill: Skill): string {
  if (skill.sourceType === 'workspace_file') return skill.description ?? '';
  if (skill.sourceType === 'registry') {
    // Curated upstream pointers retain the translated built-in description;
    // user-published registry skills use their authored summary verbatim.
    if (skill.sourceMode === 'upstream_pointer' && skill.slug) {
      return t(`skills.catalog.${skill.slug}` as MessageKey);
    }
    return skill.description ?? '';
  }
  return t(`skills.catalog.${skill.id}` as MessageKey);
}

/** The skill's folder on GitHub, or '' for skills with no upstream repo. */
export function skillGitHubUrl(skill: Skill): string {
  return skill.sourceRepo ? `https://github.com/${skill.sourceRepo}/tree/main/${skill.sourcePath}` : '';
}

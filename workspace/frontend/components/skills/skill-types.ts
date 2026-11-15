/** One skill as the Skill Hub shows it, whatever its source. */
export interface Skill {
  id: string;
  /** Stable id sent to install/status APIs. Upstream catalog skills keep their
   * historical slug while Registry-native skills use their UUID. */
  installId?: string;
  name: string;
  /**
   * Only custom (uploaded) skills carry their description inline — it's user
   * data. Catalogue descriptions live in the message catalogue under
   * `skills.catalog.<id>` and are resolved by {@link useSkillDescription}.
   */
  description?: string;
  category: string;
  tags: string[];
  // Catalog skills carry logo + GitHub source; custom (uploaded) skills don't.
  logo?: string;
  sourceRepo?: string;
  sourcePath?: string;
  author?: string;
  featured?: boolean;
  // Custom (workspace_file) skills — uploaded .md/.zip packages.
  sourceType?: 'catalog' | 'workspace_file' | 'registry';
  fileId?: string;
  filename?: string;
  contentType?: string;
  packageType?: 'md' | 'zip';
  workspaceSkillId?: string;
  registrySkillId?: string;
  slug?: string;
  namespace?: string;
  namespaceName?: string;
  version?: string;
  versionId?: string;
  sourceMode?: 'mirrored' | 'upstream_pointer';
  license?: string;
  forkedFromVersionId?: string | null;
  installCount?: number;
  unavailable?: boolean;
  visibility?: 'public' | 'unlisted';
}

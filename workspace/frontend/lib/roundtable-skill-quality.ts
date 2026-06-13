import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export type SkillQualityStatus = 'verified' | 'verified_candidate' | 'draft';
export type SkillQualityFailure =
  | 'missing_skill'
  | 'missing_research_files'
  | 'research_too_thin'
  | 'missing_source_manifest'
  | 'too_few_primary_sources'
  | 'missing_agentic_protocol';

export interface SkillQualityAssessment {
  id: string;
  type: 'person' | 'functional' | 'unknown';
  path: string;
  status: SkillQualityStatus;
  skillChars: number;
  researchFileCount: number;
  researchChars: number;
  primarySourceMentions: number;
  hasSourceManifest: boolean;
  step2: string;
  failures: SkillQualityFailure[];
}

export interface ProtocolSimilarity {
  leftId: string;
  rightId: string;
  score: number;
  tooSimilar: boolean;
}

export interface SkillAuditReport {
  root: string;
  generatedAt: string;
  assessments: SkillQualityAssessment[];
  protocolSimilarity: ProtocolSimilarity[];
  summary: {
    total: number;
    verified: number;
    verifiedCandidate: number;
    draft: number;
  };
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function listMarkdownFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => join(path, name));
}

function countPrimaryMentions(value: string): number {
  const matches = value.match(/primary|一手|本人|股东信|演讲|访谈|transcript|letter|book|著作/gi);
  return matches?.length || 0;
}

function extractStep2(skill: string): string {
  const start = skill.search(/###\s*Step\s*2|Step 2|研究维度/i);
  if (start < 0) return '';
  const rest = skill.slice(start);
  const next = rest.slice(1).search(/\n###\s*Step\s*3|\n##\s+/i);
  return (next >= 0 ? rest.slice(0, next + 1) : rest).trim();
}

function inferType(skillDir: string, skill: string): SkillQualityAssessment['type'] {
  const id = basename(skillDir);
  if (/perspective|leader|musk|bezos|jobs|thiel|grove|walton|drucker/i.test(id)) return 'person';
  if (/agent|keeper|chair|summary|consensus/i.test(id) || /岗位|职能/.test(skill)) return 'functional';
  return 'unknown';
}

export function assessSkillDirectory(skillDir: string): SkillQualityAssessment {
  const id = basename(skillDir);
  const skillPath = join(skillDir, 'SKILL.md');
  const skill = readIfExists(skillPath);
  const type = inferType(skillDir, skill);
  const researchFiles = listMarkdownFiles(join(skillDir, 'references', 'research'));
  const researchText = researchFiles.map(readIfExists).join('\n');
  const manifestPath = join(skillDir, 'references', 'sources', 'source-manifest.json');
  const hasSourceManifest = existsSync(manifestPath);
  const sourceManifest = readIfExists(manifestPath);
  const failures: SkillQualityFailure[] = [];

  if (!skill) failures.push('missing_skill');
  if (researchFiles.length < 6 && type === 'person') failures.push('missing_research_files');
  if (researchText.length < 6000 && type === 'person') failures.push('research_too_thin');
  if (!hasSourceManifest && type === 'person') failures.push('missing_source_manifest');

  const primarySourceMentions = countPrimaryMentions(skill + '\n' + researchText + '\n' + sourceManifest);
  if (type === 'person' && primarySourceMentions < 10) failures.push('too_few_primary_sources');

  const step2 = extractStep2(skill);
  if (!step2 && type === 'person') failures.push('missing_agentic_protocol');

  const status: SkillQualityStatus = failures.length ? 'draft' : 'verified_candidate';

  return {
    id,
    type,
    path: skillDir,
    status,
    skillChars: skill.length,
    researchFileCount: researchFiles.length,
    researchChars: researchText.length,
    primarySourceMentions,
    hasSourceManifest,
    step2,
    failures,
  };
}

function tokenSet(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .replace(/[^\u4e00-\u9fffa-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((item) => item.length > 1));
}

export function compareAgenticProtocolSimilarity(items: Array<{ id: string; step2: string }>): ProtocolSimilarity[] {
  const results: ProtocolSimilarity[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = tokenSet(items[i].step2);
      const right = tokenSet(items[j].step2);
      const leftTokens = Array.from(left);
      const rightTokens = Array.from(right);
      const intersection = leftTokens.filter((token) => right.has(token)).length;
      const union = new Set(leftTokens.concat(rightTokens)).size || 1;
      const score = intersection / union;
      results.push({
        leftId: items[i].id,
        rightId: items[j].id,
        score,
        tooSimilar: score >= 0.72,
      });
    }
  }
  return results;
}

export function auditRoundtableSkills(root: string): SkillAuditReport {
  const dirs = existsSync(root)
    ? readdirSync(root)
      .map((name) => join(root, name))
      .filter((path) => statSync(path).isDirectory())
    : [];
  const assessments = dirs.map(assessSkillDirectory);
  const protocolSimilarity = compareAgenticProtocolSimilarity(
    assessments
      .filter((item) => item.type === 'person')
      .map((item) => ({ id: item.id, step2: item.step2 })),
  );
  const withSimilarityFailures = assessments.map((item) => {
    if (item.type !== 'person') return item;
    const tooSimilar = protocolSimilarity.some((pair) =>
      pair.tooSimilar && (pair.leftId === item.id || pair.rightId === item.id)
    );
    if (!tooSimilar || item.failures.includes('missing_agentic_protocol')) return item;
    return { ...item, status: 'draft' as const, failures: [...item.failures] };
  });
  return {
    root,
    generatedAt: new Date().toISOString(),
    assessments: withSimilarityFailures,
    protocolSimilarity,
    summary: {
      total: withSimilarityFailures.length,
      verified: withSimilarityFailures.filter((item) => item.status === 'verified').length,
      verifiedCandidate: withSimilarityFailures.filter((item) => item.status === 'verified_candidate').length,
      draft: withSimilarityFailures.filter((item) => item.status === 'draft').length,
    },
  };
}

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessSkillDirectory,
  auditRoundtableSkills,
  compareAgenticProtocolSimilarity,
  type SkillQualityAssessment,
} from '../lib/roundtable-skill-quality';

const tmpRoot = join(process.cwd(), '.tmp-roundtable-skill-quality');
rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });

function writeSkill(id: string, body: string, researchBodies: string[], manifest = true): string {
  const dir = join(tmpRoot, id);
  mkdirSync(join(dir, 'references', 'research'), { recursive: true });
  mkdirSync(join(dir, 'references', 'sources'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8');
  researchBodies.forEach((text, index) => {
    writeFileSync(join(dir, 'references', 'research', `0${index + 1}-x.md`), text, 'utf8');
  });
  if (manifest) {
    writeFileSync(join(dir, 'references', 'sources', 'source-manifest.json'), JSON.stringify({
      sources: Array.from({ length: 10 }, (_, index) => ({
        id: `primary-${index}`,
        type: 'primary',
        title: `Primary ${index}`,
        url: `https://example.com/${index}`,
      })),
    }, null, 2), 'utf8');
  }
  return dir;
}

const repeatedProtocol = [
  '### Step 2: 研究维度',
  '- 查经典来源是否支持该角色方法，不把网络摘要当一手事实。',
  '- 查当前议题的关键约束：客户、成本、政策、证据、组织能力、时间窗口。',
  '- 标注“已证实 / 未证实 / 推断 / 需要证据”。',
].join('\n');

const strongResearch = Array.from({ length: 6 }, (_, index) =>
  `# Research ${index}\n` +
  Array.from({ length: 24 }, (__, line) => `primary excerpt ${index}-${line}: source-backed observation with specific context.`).join('\n')
);

const strongDir = writeSkill(
  'strong-leader',
  `# Strong Leader\n## Agentic Protocol\n${repeatedProtocol}\n## 核心心智模型\n一手来源 primary primary primary primary primary primary primary primary primary primary`,
  strongResearch,
);

const weakDir = writeSkill(
  'weak-leader',
  '# Weak Leader\n## Agentic Protocol\n' + repeatedProtocol,
  ['thin', 'thin', 'thin', 'thin', 'thin', 'thin'],
  false,
);

const strong = assessSkillDirectory(strongDir);
const weak = assessSkillDirectory(weakDir);

assert.equal(strong.status, 'verified_candidate');
assert.equal(strong.hasSourceManifest, true);
assert.equal(strong.researchFileCount, 6);
assert.equal(strong.failures.length, 0);

assert.equal(weak.status, 'draft');
assert.equal(weak.hasSourceManifest, false);
assert.ok(weak.failures.includes('missing_source_manifest'));
assert.ok(weak.failures.includes('research_too_thin'));

const similarity = compareAgenticProtocolSimilarity([
  { id: 'a', step2: repeatedProtocol },
  { id: 'b', step2: repeatedProtocol.replace('研究维度', '人物式研究维度') },
]);
assert.equal(similarity[0].tooSimilar, true);

const audit = auditRoundtableSkills(join(process.cwd(), '..', '..', 'roundtable-skills'));
const personAssessments = audit.assessments.filter((item: SkillQualityAssessment) => item.type === 'person');
assert.equal(personAssessments.length >= 7, true);
assert.equal(personAssessments.every((item) => item.status !== 'verified'), true);
assert.equal(audit.summary.verified, 0);
assert.equal(audit.summary.draft >= 7, true);

console.log(JSON.stringify({
  status: 'pass',
  tmpRoot,
  currentRoundtableDraftPeople: personAssessments.map((item) => ({
    id: item.id,
    status: item.status,
    failures: item.failures,
  })),
}, null, 2));

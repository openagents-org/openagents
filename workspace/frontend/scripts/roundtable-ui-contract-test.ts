import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'components/roundtable/roundtable-view.tsx'), 'utf8');

for (const required of [
  '圆桌智策',
  'P0 试用版',
  '参与智能体',
  '讨论区',
  '事实包',
  '关系图谱',
  '最终输出',
  '新会话：AI 原生产品的商业化策略讨论',
  'bg-[#070c13]',
  'roundtable-reference-shell',
  'Agent Registry',
  'Verified Role Agent',
  'Legacy Prompt',
  'Draft Skill',
  '后台研究',
  'Skill 状态',
  '质量分',
]) {
  assert.ok(source.includes(required), `missing UI contract marker: ${required}`);
}

console.log(JSON.stringify({
  status: 'pass',
  checked: 'roundtable screenshot replica contract',
}, null, 2));

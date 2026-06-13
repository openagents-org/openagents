import assert from 'node:assert/strict';
import { judgeRoundtableOutput } from '../lib/roundtable-quality-judge';

const masked = judgeRoundtableOutput({
  content: '我以“埃隆·马斯克视角”参与，非本人观点。你的挑战成立。',
  interactionType: 'challenge',
  targetAgentIds: [],
});
assert.equal(masked.pass, false);
assert.ok(masked.failures.includes('mask_language'));

const strong = judgeRoundtableOutput({
  content: '彼得，这里不是战略问题，是证据链断了。先拿三家医院的采用意愿、合规边界和一周内可跑的失败判据，否则别扩大投入。',
  interactionType: 'challenge',
  targetAgentIds: ['drucker'],
  evidenceRequest: '三家医院采用意愿、合规边界、一周内失败判据。',
});
assert.equal(strong.pass, true);
assert.equal(strong.scores.disagreementIntensity >= 0.6, true);
assert.equal(strong.scores.evidenceDiscipline >= 0.6, true);
assert.equal(strong.scores.actionability >= 0.6, true);

console.log(JSON.stringify({ status: 'pass', strong }, null, 2));

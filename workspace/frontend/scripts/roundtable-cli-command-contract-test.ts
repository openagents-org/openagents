import assert from 'node:assert/strict';
import {
  buildCodexArgs,
  buildClaudeArgs,
  type RoundtableCliRunInput,
} from '../lib/roundtable-cli-runner';

const roleInput: RoundtableCliRunInput = {
  runtime: 'codex_cli',
  prompt: 'Role task prompt without skill body',
  agentName: '埃隆·马斯克',
  phaseId: 'round2',
  roleAgent: {
    skillId: 'musk-first-principles-perspective',
    skillPath: 'roundtable-skills/musk-first-principles-perspective/SKILL.md',
    skillLoadStatus: 'verified_loaded',
    mode: 'role_agent',
  },
};

const roleArgs = buildCodexArgs({
  input: roleInput,
  outputPath: 'out.txt',
  runtimeCwd: 'C:/repo',
});

assert.equal(roleArgs.includes('--ignore-user-config'), false);
assert.equal(roleArgs.includes('--ignore-rules'), false);
assert.equal(roleArgs.includes('--ephemeral'), false);
assert.equal(roleArgs.includes('--cd'), true);
assert.equal(roleArgs.includes('C:/repo'), true);

const legacyArgs = buildCodexArgs({
  input: { ...roleInput, roleAgent: undefined },
  outputPath: 'out.txt',
  runtimeCwd: 'C:/repo',
});
assert.equal(legacyArgs.includes('--ignore-user-config'), true);
assert.equal(legacyArgs.includes('--ignore-rules'), true);
assert.equal(legacyArgs.includes('--ephemeral'), true);

const claudeArgs = buildClaudeArgs(roleInput);
assert.equal(claudeArgs.includes('--disable-slash-commands'), false);
assert.equal(claudeArgs.includes('--no-session-persistence'), false);

console.log(JSON.stringify({ status: 'pass', roleArgs, legacyArgs }, null, 2));

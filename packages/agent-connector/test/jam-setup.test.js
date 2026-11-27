'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jam = require('../src/jam-setup');

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jam-home-')); }

describe('agn jam setup', () => {
  it("installs the server's skill for Claude Code, and for other agents only when present", async () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.codex'));
    const served = '---\nname: openagents-jam\ndescription: x\n---\nFetch https://oa.example.test/jam\n';
    const seen = [];
    const fetchImpl = async (url) => { seen.push(url); return { ok: true, text: async () => served }; };
    const out = await jam.setup({ endpoint: 'https://oa.example.test/', home, fetchImpl });
    assert.deepEqual(seen, ['https://oa.example.test/jam/skill.md']);
    assert.equal(out.fromServer, true);
    assert.deepEqual(out.installed.map(i => i.agent), ['Claude Code', 'Codex']);
    assert.equal(fs.readFileSync(path.join(home, '.claude/skills/openagents-jam/SKILL.md'), 'utf8'), served);
    assert.ok(!fs.existsSync(path.join(home, '.config/opencode/skills/openagents-jam')));
  });

  it('falls back to a built-in skill pointing at the same server when it is unreachable', async () => {
    const home = tmpHome();
    const out = await jam.setup({ endpoint: 'https://self.hosted.test', home, fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(out.fromServer, false);
    const text = fs.readFileSync(out.installed[0].file, 'utf8');
    assert.match(text, /^---\nname: openagents-jam\n/);
    assert.match(text, /https:\/\/self\.hosted\.test\/jam/);
  });

  it('ignores a server reply that is not the skill', async () => {
    const home = tmpHome();
    const out = await jam.setup({ home, fetchImpl: async () => ({ ok: true, text: async () => '<html>404</html>' }) });
    assert.equal(out.fromServer, false);
  });

  it('remove takes the skill out of every agent', async () => {
    const home = tmpHome();
    await jam.setup({ home, fetchImpl: async () => { throw new Error('x'); } });
    assert.equal(jam.remove({ home }).removed.length, 1);
    assert.ok(!fs.existsSync(path.join(home, '.claude/skills/openagents-jam')));
  });
});

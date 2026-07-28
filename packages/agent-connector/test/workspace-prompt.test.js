'use strict';

/**
 * Workspace-prompt identity tests.
 *
 * Guards the per-agent skill naming that fixes cross-agent identity clobbering:
 * two agents sharing a working directory used to overwrite one shared
 * `openagents-workspace.md`, so the `source: openagents:<name>` embedded in
 * its curl commands belonged to whichever agent wrote last — and files one
 * agent uploaded were attributed to the other in the workspace Files list.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  workspaceSkillName,
  buildClaudeSkillMd,
  buildCursorSkillMd,
  buildOpenCodeSkillMd,
  buildOpenclawSkillMd,
  buildClaudeSystemPrompt,
} = require('../src/adapters/workspace-prompt');

const COMMON = {
  endpoint: 'https://example.test',
  workspaceId: 'ws-1',
  token: 'tok',
  channelName: 'general',
  disabledModules: new Set(),
};

// Agent Skills spec: lowercase kebab-case, no leading/trailing/consecutive
// hyphens, at most 64 characters (https://agentskills.io/specification).
const SPEC_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('workspaceSkillName', () => {
  it('namespaces the skill by agent, keeping already-valid names readable', () => {
    assert.strictEqual(workspaceSkillName('qiyue-bot'), 'openagents-workspace-qiyue-bot');
  });

  it('falls back to a stable default for empty names', () => {
    assert.strictEqual(workspaceSkillName(''), 'openagents-workspace-agent');
    assert.strictEqual(workspaceSkillName(undefined), 'openagents-workspace-agent');
  });

  it('always emits a spec-compliant name, whatever the agent name', () => {
    const hostile = [
      'My_Agent', 'UPPER', 'my agent/№1', '---a__B---', '.dots.everywhere.',
      '中文名字', 'a'.repeat(64), `X${'-'.repeat(30)}y`, '🤖',
    ];
    for (const name of hostile) {
      const skill = workspaceSkillName(name);
      assert.ok(skill.length <= 64, `${skill} exceeds 64 chars`);
      assert.match(skill, SPEC_NAME_RE, `${skill} is not lowercase kebab-case`);
    }
  });

  it('is deterministic', () => {
    assert.strictEqual(workspaceSkillName('My_Agent'), workspaceSkillName('My_Agent'));
  });

  it('keeps agents distinct when normalization would make their names collide', () => {
    // Case/underscore folding maps both to "my-agent" — converging would
    // silently reintroduce the shared-identity clobbering.
    assert.notStrictEqual(workspaceSkillName('My_Agent'), workspaceSkillName('my-agent'));
    // Truncation of long names must not collide either.
    const stem = 'a'.repeat(60);
    assert.notStrictEqual(workspaceSkillName(`${stem}x`), workspaceSkillName(`${stem}y`));
  });
});

describe('skill markdown identity', () => {
  for (const [label, build] of [
    ['claude', buildClaudeSkillMd],
    ['cursor', buildCursorSkillMd],
    ['opencode', buildOpenCodeSkillMd],
    ['openclaw', buildOpenclawSkillMd],
  ]) {
    it(`${label}: frontmatter name and curl source both carry the agent identity`, () => {
      const md = build({ ...COMMON, agentName: 'qiyue-bot' });
      assert.match(md, /^---\nname: openagents-workspace-qiyue-bot\n/);
      assert.ok(md.includes('openagents:qiyue-bot'), 'curl commands must embed the agent identity');
      assert.ok(!md.includes('\nname: openagents-workspace\n'), 'must not use the shared legacy skill name');
    });
  }

  it('two agents produce distinctly named skills (no last-writer-wins)', () => {
    const a = buildClaudeSkillMd({ ...COMMON, agentName: 'qiyue-bot' });
    const b = buildClaudeSkillMd({ ...COMMON, agentName: 'cherie-bot' });
    assert.match(a, /name: openagents-workspace-qiyue-bot/);
    assert.match(b, /name: openagents-workspace-cherie-bot/);
    assert.ok(!a.includes('cherie-bot'));
    assert.ok(!b.includes('qiyue-bot'));
  });
});

describe('claude system prompt (skills mode)', () => {
  it('points the model at its own per-agent skill', () => {
    const prompt = buildClaudeSystemPrompt({
      agentName: 'qiyue-bot',
      workspaceId: 'ws-1',
      channelName: 'general',
      toolMode: 'skills',
    });
    assert.ok(prompt.includes('openagents-workspace-qiyue-bot skill'));
    assert.ok(!/openagents-workspace skill/.test(prompt), 'must not reference the shared legacy skill name');
  });
});

describe('CursorAdapter — shared working directory', () => {
  const CursorAdapter = require('../src/adapters/cursor');

  function makeCursor(agentName, workingDir) {
    const adapter = new CursorAdapter({
      workspaceId: 'ws-1',
      channelName: 'general',
      token: 'tok',
      agentName,
      workingDir,
    });
    adapter._log = () => {};
    return adapter;
  }

  it('lets two agents keep coexisting skills, each with its own identity', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cursor-test-'));
    try {
      const skillDir = path.join(workDir, '.cursor', 'skills');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'openagents-workspace.md'), 'stale shared file');

      makeCursor('qiyue-bot', workDir)._writeSkillFile('general');
      makeCursor('cherie-bot', workDir)._writeSkillFile('general');

      const qiyue = fs.readFileSync(path.join(skillDir, 'openagents-workspace-qiyue-bot.md'), 'utf-8');
      const cherie = fs.readFileSync(path.join(skillDir, 'openagents-workspace-cherie-bot.md'), 'utf-8');
      assert.ok(qiyue.includes('openagents:qiyue-bot') && !qiyue.includes('cherie-bot'));
      assert.ok(cherie.includes('openagents:cherie-bot') && !cherie.includes('qiyue-bot'));
      assert.ok(!fs.existsSync(path.join(skillDir, 'openagents-workspace.md')),
        'legacy shared skill file must be deleted');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('pins identity and the exact skill name in every spawned prompt', () => {
    // Cursor has no system-prompt flag: without this header the model only
    // learns who it is from whichever coexisting skill it happens to open.
    const adapter = makeCursor('qiyue-bot');
    adapter._findCursorBinary = () => '/bin/cursor-agent';
    const cmd = adapter._buildCursorCmd('hello world', 'general');
    const prompt = cmd[cmd.indexOf('-p') + 1];
    assert.ok(prompt.includes("You are agent 'qiyue-bot'"));
    assert.ok(prompt.includes("'openagents-workspace-qiyue-bot' skill"));
    assert.ok(prompt.endsWith('hello world'));
  });
});

describe('OpenClawAdapter — legacy skill dir migration', () => {
  const OpenClawAdapter = require('../src/adapters/openclaw');

  // The base constructor ALREADY runs _installWorkspaceSkill, so the redirect
  // to the temp dir must be in place before construction (a prototype-level
  // override, not a post-hoc instance patch) — otherwise merely constructing
  // the adapter reads/deletes the developer's real ~/.openclaw/workspace.
  function makeOpenclaw(agentName, wsDir) {
    class SandboxedOpenClaw extends OpenClawAdapter {
      _resolveOpenclawWorkspace() { return wsDir; }
    }
    const origLog = console.log;
    console.log = () => {};
    try {
      const adapter = new SandboxedOpenClaw({
        workspaceId: 'ws-1',
        channelName: 'general',
        token: 'tok',
        agentName,
      });
      adapter._log = () => {};
      return adapter;
    } finally {
      console.log = origLog;
    }
  }

  it('removes the raw-name legacy dir when normalization renamed the skill', () => {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-openclaw-test-'));
    try {
      // Pre-normalization layout: skill dir named after the RAW agent name,
      // whose SKILL.md embeds its owner's identity (as the builder always has).
      const legacyDir = path.join(wsDir, 'skills', 'openagents-workspace-My_Agent');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, 'SKILL.md'),
        "You are agent 'My_Agent' connected to an OpenAgents workspace. (stale)");

      makeOpenclaw('My_Agent', wsDir)._installWorkspaceSkill();

      const current = path.join(wsDir, 'skills', workspaceSkillName('My_Agent'), 'SKILL.md');
      assert.ok(fs.existsSync(current), 'normalized skill dir must be written');
      assert.ok(fs.readFileSync(current, 'utf-8').includes('openagents:My_Agent'));
      assert.ok(!fs.existsSync(legacyDir), 'stale raw-name dir must be deleted');
    } finally {
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it('never deletes a dir owned by another agent (Windows case-alias regression)', () => {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-openclaw-test-'));
    try {
      // On a case-insensitive filesystem, agent Foo's legacy path
      // openagents-workspace-Foo IS agent foo's current dir. Materialize that
      // alias on any FS — a dir at Foo's legacy path holding foo's skill —
      // and require the ownership check to refuse the delete.
      const aliasDir = path.join(wsDir, 'skills', 'openagents-workspace-Foo');
      fs.mkdirSync(aliasDir, { recursive: true });
      fs.writeFileSync(path.join(aliasDir, 'SKILL.md'),
        "You are agent 'foo' connected to an OpenAgents workspace.");

      makeOpenclaw('Foo', wsDir);

      assert.ok(fs.existsSync(path.join(aliasDir, 'SKILL.md')),
        "another agent's live skill must survive Foo's migration");
    } finally {
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it('skips deletion when ownership cannot be proven', () => {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-openclaw-test-'));
    try {
      const legacyDir = path.join(wsDir, 'skills', 'openagents-workspace-My_Agent');
      fs.mkdirSync(legacyDir, { recursive: true });
      // No SKILL.md — nothing proves whose dir this is, so it must be left.
      fs.writeFileSync(path.join(legacyDir, 'notes.txt'), 'unrelated');

      makeOpenclaw('My_Agent', wsDir);

      assert.ok(fs.existsSync(path.join(legacyDir, 'notes.txt')));
    } finally {
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it('never lets a hostile agent name escape the skills root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-openclaw-test-'));
    try {
      const wsDir = path.join(root, 'ws');
      const victim = path.join(root, 'victim');
      fs.mkdirSync(path.join(wsDir, 'skills'), { recursive: true });
      fs.mkdirSync(victim, { recursive: true });
      fs.writeFileSync(path.join(victim, 'keep.txt'), 'do not delete');

      // Joined blindly, the legacy path for this name resolves to <root>/victim.
      makeOpenclaw('x/../../../victim', wsDir);

      assert.ok(fs.existsSync(path.join(victim, 'keep.txt')),
        'a path outside the skills root must never be deleted');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves the dir alone when the name needs no normalization', () => {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-openclaw-test-'));
    try {
      makeOpenclaw('qiyue-bot', wsDir)._installWorkspaceSkill();
      const skillMd = path.join(wsDir, 'skills', 'openagents-workspace-qiyue-bot', 'SKILL.md');
      assert.ok(fs.existsSync(skillMd));
      assert.ok(fs.readFileSync(skillMd, 'utf-8').includes('openagents:qiyue-bot'));
    } finally {
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
  });
});

describe('ClaudeAdapter._buildSkillsCmd', () => {
  it('writes a per-agent skill file and removes the legacy shared one', () => {
    const ClaudeAdapter = require('../src/adapters/claude');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-skill-test-'));
    try {
      const skillDir = path.join(workDir, '.claude', 'skills');
      fs.mkdirSync(skillDir, { recursive: true });
      // Simulate a stale shared file written by ANOTHER agent (pre-fix layout).
      const legacy = path.join(skillDir, 'openagents-workspace.md');
      fs.writeFileSync(legacy, 'source: openagents:cherie-bot');

      const adapter = new ClaudeAdapter({
        workspaceId: 'ws-1',
        channelName: 'general',
        token: 'tok',
        agentName: 'qiyue-bot',
        workingDir: workDir,
        toolMode: 'skills',
      });
      adapter._log = () => {};

      const { skillFile } = adapter._buildSkillsCmd(['claude'], 'general');

      assert.strictEqual(path.basename(skillFile), 'openagents-workspace-qiyue-bot.md');
      const content = fs.readFileSync(skillFile, 'utf-8');
      assert.ok(content.includes('openagents:qiyue-bot'));
      assert.ok(!content.includes('cherie-bot'));
      assert.ok(!fs.existsSync(legacy), 'legacy shared skill file must be deleted');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

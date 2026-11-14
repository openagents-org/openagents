'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const memory = require('../src/memory-import');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

let home;
let configDir;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-mem-'));
  configDir = path.join(home, '.openagents');
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function opts(type, extra = {}) {
  return {
    name: `my-${type}`,
    type,
    workingDir: path.join(configDir, 'workspaces', `my-${type}`),
    env: {},
    configDir,
    home,
    ...extra,
  };
}

/** A Claude Code project as Claude Code files it: transcript with cwd + memory/. */
function claudeProject(cwd, { memoryFiles = {}, claudeMd } = {}) {
  const dir = path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  write(path.join(dir, 'abc.jsonl'), `${JSON.stringify({ type: 'user', cwd, sessionId: 'abc' })}\n`);
  for (const [name, text] of Object.entries(memoryFiles)) write(path.join(dir, 'memory', name), text);
  if (claudeMd) write(path.join(cwd, 'CLAUDE.md'), claudeMd);
  return dir;
}

describe('memory import — Claude Code', () => {
  it('lists global memory as already loaded and project memory as importable', () => {
    write(path.join(home, '.claude', 'CLAUDE.md'), '# global');
    write(path.join(home, '.claude', 'skills', 'writer', 'SKILL.md'), '---\nname: writer\n---\n');
    const repo = path.join(home, 'code', 'shop');
    claudeProject(repo, { memoryFiles: { 'MEMORY.md': '- [Deploy](deploy.md)', 'deploy.md': 'deploy with make ship' }, claudeMd: '# shop rules' });

    const scan = memory.scanMemory(opts('claude'));
    assert.equal(scan.supported, true);
    const byId = Object.fromEntries(scan.items.map((i) => [i.id, i]));
    assert.equal(byId['claude:global'].status, 'loaded');
    assert.equal(byId['claude:user-skills'].status, 'loaded');
    const project = scan.items.find((i) => i.kind === 'memory');
    assert.equal(project.status, 'importable');
    assert.equal(project.selected, true);
    assert.equal(project.fileCount, 3);
    assert.match(project.label, /shop/);
    // Paths go out home-relative, never absolute.
    assert.ok(project.source.startsWith('~'));
  });

  it('skips the folders agents run in', () => {
    claudeProject(path.join(configDir, 'workspaces', 'other-agent'), { memoryFiles: { 'MEMORY.md': 'x' } });
    const scan = memory.scanMemory(opts('claude'));
    assert.equal(scan.items.filter((i) => i.kind === 'memory').length, 0);
  });

  it('imports into the agent store, feeds the prompt, and undoes cleanly', () => {
    const repo = path.join(home, 'code', 'shop');
    claudeProject(repo, { memoryFiles: { 'MEMORY.md': '- [Deploy](deploy.md)', 'deploy.md': 'deploy with make ship' }, claudeMd: '# shop rules' });
    const o = opts('claude');
    const scan = memory.scanMemory(o);
    const ids = scan.items.filter((i) => i.selected).map((i) => i.id);

    const receipt = memory.importMemory(o, ids);
    assert.equal(receipt.items.length, 1);
    assert.equal(receipt.files, 3);
    // Sources untouched.
    assert.equal(fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf-8'), '# shop rules');

    const prompt = memory.buildImportedMemoryPrompt({ agentName: o.name, configDir });
    assert.match(prompt, /Memory brought over/);
    assert.match(prompt, /# shop rules/);
    assert.match(prompt, /- \[Deploy\]\(deploy\.md\)/);
    // Non-index notes are listed by path, not inlined.
    assert.match(prompt, /deploy\.md/);
    assert.doesNotMatch(prompt, /make ship/);

    const after = memory.scanMemory(o);
    assert.equal(after.items.find((i) => i.id === ids[0]).status, 'imported');
    assert.ok(after.importedAt);
    assert.equal(memory.memorySummary(o).status, 'imported');

    const undone = memory.undoImport(o);
    assert.ok(undone.removed >= 3);
    assert.equal(memory.buildImportedMemoryPrompt({ agentName: o.name, configDir }), '');
    assert.equal(memory.scanMemory(o).items.find((i) => i.id === ids[0]).status, 'importable');
  });

  it('flags likely credentials and leaves them unselected', () => {
    const repo = path.join(home, 'code', 'api');
    claudeProject(repo, { claudeMd: 'Use OPENAI key sk-proj-abcdefghijklmnopqrstuvwxyz0123 for tests' });
    const item = memory.scanMemory(opts('claude')).items.find((i) => i.kind === 'memory');
    assert.equal(item.secret, true);
    assert.equal(item.selected, false);
  });

  it('copies project skills into the agent skills folder', () => {
    const repo = path.join(home, 'code', 'shop');
    claudeProject(repo);
    write(path.join(repo, '.claude', 'skills', 'release', 'SKILL.md'), '---\nname: release\ndescription: Ship a release\n---\nsteps');
    const o = opts('claude');
    const skill = memory.scanMemory(o).items.find((i) => i.kind === 'skill' && i.status === 'importable');
    assert.equal(skill.description, 'Ship a release');
    memory.importMemory(o, [skill.id]);
    assert.ok(fs.existsSync(path.join(o.workingDir, '.claude', 'skills', 'release', 'SKILL.md')));
    memory.undoImport(o);
    assert.ok(!fs.existsSync(path.join(o.workingDir, '.claude', 'skills', 'release')));
  });

  it('refuses an empty pick and items already imported', () => {
    const repo = path.join(home, 'code', 'shop');
    claudeProject(repo, { claudeMd: '# rules' });
    const o = opts('claude');
    assert.throws(() => memory.importMemory(o, []), /Pick at least one/);
    const id = memory.scanMemory(o).items.find((i) => i.kind === 'memory').id;
    memory.importMemory(o, [id]);
    assert.throws(() => memory.importMemory(o, [id]), /Nothing left/);
  });
});

describe('memory import — Codex', () => {
  it('finds project AGENTS.md through session cwds', () => {
    write(path.join(home, '.codex', 'AGENTS.md'), '# global codex');
    const repo = path.join(home, 'code', 'svc');
    write(path.join(repo, 'AGENTS.md'), '# svc rules');
    write(path.join(home, '.codex', 'sessions', '2026', '11', '10', 'rollout-1.jsonl'),
      `${JSON.stringify({ type: 'session_meta', payload: { cwd: repo } })}\n`);
    const o = opts('codex');
    const scan = memory.scanMemory(o);
    assert.equal(scan.items.find((i) => i.id === 'codex:global:AGENTS.md').status, 'loaded');
    const proj = scan.items.find((i) => i.id.startsWith('codex:project:'));
    assert.equal(proj.status, 'importable');
    memory.importMemory(o, [proj.id]);
    assert.match(memory.buildImportedMemoryPrompt({ agentName: o.name, configDir }), /# svc rules/);
  });
});

describe('memory import — OpenClaw', () => {
  function userOpenclaw() {
    const ws = path.join(home, '.openclaw', 'workspace');
    write(path.join(ws, 'SOUL.md'), 'calm and direct');
    write(path.join(ws, 'USER.md'), 'Name: Ada');
    write(path.join(ws, 'MEMORY.md'), 'Ada prefers tea');
    write(path.join(ws, 'memory', '2026-11-01.md'), 'met about launch');
    write(path.join(ws, 'skills', 'weather', 'SKILL.md'), '---\nname: weather\n---\n');
    write(path.join(ws, 'skills', 'openagents-workspace-x', 'SKILL.md'), 'ours');
    return ws;
  }

  it('reports everything as loaded when the agent uses the user\'s own OpenClaw', () => {
    userOpenclaw();
    const scan = memory.scanMemory(opts('openclaw'));
    assert.ok(scan.items.length >= 4);
    assert.ok(scan.items.every((i) => i.status === 'loaded'));
    assert.ok(!scan.items.some((i) => /openagents-workspace/.test(i.label)));
  });

  it('copies into the private workspace, retires BOOTSTRAP.md, and restores on undo', () => {
    userOpenclaw();
    const state = path.join(configDir, 'openclaw', 'abc');
    const privateWs = path.join(state, 'workspace');
    write(path.join(privateWs, 'SOUL.md'), 'template soul');
    write(path.join(privateWs, 'BOOTSTRAP.md'), 'first run ritual');
    const o = opts('openclaw', { env: { OPENCLAW_STATE_DIR: state } });

    const scan = memory.scanMemory(o);
    const ids = scan.items.filter((i) => i.selected).map((i) => i.id);
    assert.ok(ids.includes('openclaw:persona'));
    assert.ok(ids.includes('openclaw:notes'));
    memory.importMemory(o, ids);

    assert.equal(fs.readFileSync(path.join(privateWs, 'SOUL.md'), 'utf-8'), 'calm and direct');
    assert.equal(fs.readFileSync(path.join(privateWs, 'MEMORY.md'), 'utf-8'), 'Ada prefers tea');
    assert.ok(fs.existsSync(path.join(privateWs, 'memory', '2026-11-01.md')));
    assert.ok(fs.existsSync(path.join(privateWs, 'skills', 'weather', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(privateWs, 'BOOTSTRAP.md')));
    // OpenClaw reads its workspace natively: nothing goes through the prompt.
    assert.equal(memory.buildImportedMemoryPrompt({ agentName: o.name, configDir }), '');

    memory.undoImport(o);
    assert.equal(fs.readFileSync(path.join(privateWs, 'SOUL.md'), 'utf-8'), 'template soul');
    assert.equal(fs.readFileSync(path.join(privateWs, 'BOOTSTRAP.md'), 'utf-8'), 'first run ritual');
    assert.ok(!fs.existsSync(path.join(privateWs, 'MEMORY.md')));
    assert.ok(!fs.existsSync(path.join(privateWs, 'skills', 'weather')));
  });
});

describe('memory import — one file under two names', () => {
  // A case-insensitive disk shows MEMORY.md and memory.md as one file; a
  // symlink gives the same situation on any OS.
  it('copies it once, so undo leaves nothing behind', () => {
    const ws = path.join(home, '.openclaw', 'workspace');
    write(path.join(ws, 'MEMORY.md'), 'Ada prefers tea');
    try { fs.symlinkSync(path.join(ws, 'MEMORY.md'), path.join(ws, 'memory.md')); } catch { /* no symlinks here */ }
    const state = path.join(configDir, 'openclaw', 'abc');
    const privateWs = path.join(state, 'workspace');
    fs.mkdirSync(privateWs, { recursive: true });
    const o = opts('openclaw', { env: { OPENCLAW_STATE_DIR: state } });
    const item = memory.scanMemory(o).items.find((i) => i.id === 'openclaw:memory');
    assert.equal(item.fileCount, 1);
    memory.importMemory(o, [item.id]);
    memory.undoImport(o);
    assert.deepEqual(fs.readdirSync(privateWs), []);
  });
});

describe('memory import — status', () => {
  it('summarises available / dismissed and ignores unsupported types', () => {
    claudeProject(path.join(home, 'code', 'shop'), { claudeMd: '# rules' });
    const o = opts('claude');
    assert.equal(memory.memorySummary(o).status, 'available');
    assert.equal(memory.memorySummary(o).found, 1);
    memory.dismissMemory(o);
    assert.equal(memory.memorySummary(o).status, 'dismissed');
    assert.equal(memory.memorySummary(opts('aider')), null);
  });

  it('keeps each agent in its own store', () => {
    assert.notEqual(memory.storeDir(configDir, 'a'), memory.storeDir(configDir, 'A'));
    assert.ok(memory.storeDir(configDir, '../../etc').startsWith(path.join(configDir, 'memory')));
  });
});

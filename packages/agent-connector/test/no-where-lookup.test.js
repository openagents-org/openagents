'use strict';

// Guards against reintroducing `where` for binary lookups. On a zh-CN Windows
// it prints in the OEM codepage (936), so reading it back as UTF-8 mangled any
// profile path with non-ASCII characters (C:\Users\王…) and the agent was
// reported as "binary not found". Use whereBinary / whereAll from paths.js,
// which walk PATH in-process.

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const SRC = path.join(__dirname, '..', 'src');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// A string literal that is a `where` command — 'where', 'where npm',
// 'where goose.exe 2>nul || …' — once comments (which name `where` freely)
// are stripped.
const WHERE_EXEC = /['"`]where(?:\.exe)?(?:['"`]|\s+[\w.$-]+)/;
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

describe('binary lookup', () => {
  it('never shells out to `where`', () => {
    const offenders = sourceFiles(SRC).filter((file) => WHERE_EXEC.test(stripComments(fs.readFileSync(file, 'utf-8'))));
    assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), []);
  });
});

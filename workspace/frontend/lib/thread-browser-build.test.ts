import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps browser tab parsing executable after production minification', async () => {
  const require = createRequire(import.meta.url);
  const swc = require('next/dist/build/swc');
  await swc.loadBindings();
  const source = readFileSync(new URL('./thread-browser.ts', import.meta.url), 'utf8');
  const javascript = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS });
  const { code } = await swc.minify(javascript, { compress: true, mangle: true });
  const compiled = new Script(code);
  const exports: Record<string, (content: string) => Set<string>> = {};
  compiled.runInNewContext({ exports });
  const id = '3100acd9-8150-4729-a2ff-af059d440335';
  expect([...exports.browserTabIdsInToolStatus('curl `/v1/browser/tabs/' + id + '`')]).toEqual([id]);
  expect([...exports.browserTabIdsInToolStatus('TAB=' + id + '; curl /v1/browser/tabs/$TAB/snapshot')]).toEqual([id]);
});

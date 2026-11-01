#!/usr/bin/env node
/**
 * Workspace API client for DeepSeek Harness runs on Windows.
 *
 * dsh's Windows sandbox (`workspace-write`, the default) runs shell commands
 * under a restricted token that has no Schannel credentials, so `curl.exe` and
 * `Invoke-WebRequest` both fail every HTTPS request with SEC_E_NO_CREDENTIALS
 * — on dsh 0.2.1-rc.2 and rc.5 alike. Node's own TLS stack is unaffected, so the
 * task file points the agent at this script instead of the curl recipes every
 * other adapter uses.
 *
 * Standalone on purpose: it runs inside the sandbox as `node <this file>`, so it
 * requires nothing but Node built-ins. The token, endpoint, workspace and agent
 * name come from the child environment (see DeepSeekAdapter._buildSubprocessEnv);
 * none of them is ever passed on the command line.
 *
 *   node deepseek-workspace-api.js GET  "/v1/files?network=<id>"
 *   '<json>' | node deepseek-workspace-api.js POST /v1/events
 *   node deepseek-workspace-api.js POST /v1/events --body-file body.json
 *   node deepseek-workspace-api.js upload <file> --channel <name> [--type <mime>]
 *   node deepseek-workspace-api.js download <file-id> <out-path>
 *
 * The body of POST/PUT/PATCH is read from --body-file or stdin. Piping a
 * single-quoted PowerShell string keeps its double quotes intact, which passing
 * JSON as an argument to a native program on Windows PowerShell 5.1 does not.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ENV = {
  token: 'OPENAGENTS_WORKSPACE_AUTH',
  endpoint: 'OPENAGENTS_WORKSPACE_ENDPOINT',
  workspace: 'OPENAGENTS_WORKSPACE_ID',
  agent: 'OPENAGENTS_AGENT_NAME',
};

const MIME = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html',
  '.json': 'application/json', '.csv': 'text/csv', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.zip': 'application/zip',
};

function fail(message) {
  process.stderr.write(`workspace-api: ${message}\n`);
  process.exit(2);
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined) fail(`${name} needs a value`);
  args.splice(i, 2);
  return value;
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

async function call(method, route, body) {
  const endpoint = (process.env[ENV.endpoint] || '').replace(/\/+$/, '');
  const token = process.env[ENV.token];
  if (!endpoint) fail(`${ENV.endpoint} is not set`);
  if (!token) fail(`${ENV.token} is not set`);
  if (!route.startsWith('/')) fail(`the path must start with "/" (got ${route})`);

  const headers = { 'X-Workspace-Token': token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(endpoint + route, { method, headers, body });
  return res;
}

async function printResponse(res) {
  const text = await res.text();
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  if (!res.ok) {
    process.stderr.write(`workspace-api: HTTP ${res.status}\n`);
    process.exit(1);
  }
}

async function upload(args) {
  const channel = takeFlag(args, '--channel');
  const type = takeFlag(args, '--type');
  const file = args[0];
  if (!file) fail('usage: upload <file> --channel <name> [--type <mime>]');
  if (!channel) fail('upload needs --channel <name>');
  const workspace = process.env[ENV.workspace];
  if (!workspace) fail(`${ENV.workspace} is not set`);

  let data;
  try { data = fs.readFileSync(file); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
  const agent = process.env[ENV.agent];
  const body = JSON.stringify({
    filename: path.basename(file),
    content_base64: data.toString('base64'),
    content_type: type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    network: workspace,
    channel_name: channel,
    ...(agent ? { source: `openagents:${agent}` } : {}),
  });
  await printResponse(await call('POST', '/v1/files/base64', body));
}

async function download(args) {
  const [id, out] = args;
  if (!id || !out) fail('usage: download <file-id> <out-path>');
  const workspace = process.env[ENV.workspace] || '';
  const res = await call('GET', `/v1/files/${encodeURIComponent(id)}?network=${encodeURIComponent(workspace)}`);
  if (!res.ok) return printResponse(res);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  process.stdout.write(`saved ${out}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const verb = (args.shift() || '').toLowerCase();
  if (verb === 'upload') return upload(args);
  if (verb === 'download') return download(args);

  const method = verb.toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    fail('usage: <GET|POST|PUT|PATCH|DELETE> <path> | upload <file> --channel <name> | download <file-id> <out-path>');
  }
  const bodyFile = takeFlag(args, '--body-file');
  const route = args[0];
  if (!route) fail(`usage: ${method} <path>`);

  let body;
  if (method !== 'GET' && method !== 'DELETE') {
    body = bodyFile ? fs.readFileSync(bodyFile, 'utf-8') : (await readStdin());
    body = body.replace(/^﻿/, '').trim();
    if (!body) fail(`${method} needs a JSON body on stdin or --body-file`);
    try { JSON.parse(body); } catch (e) { fail(`the body is not valid JSON: ${e.message}`); }
  }
  await printResponse(await call(method, route, body));
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));

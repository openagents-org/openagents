'use strict';

// OpenCode's `run` client rejects every permission. Use its loopback server
// instead, and mirror the same completed-part JSON events the adapter parses.
const { spawn } = require('child_process');
const crypto = require('crypto');
const { WorkspaceClient } = require('../workspace-client');

const delay = (ms, signal) => require('timers/promises').setTimeout(ms, undefined, { signal });

async function decidePermission(client, config, permission, { signal, emit, pollMs = 1500, timeoutMs = 600000 } = {}) {
  const details = JSON.stringify({ permission: permission.permission, patterns: permission.patterns,
    metadata: permission.metadata, tool: permission.tool });
  // Truncating the action being approved would hide its scope. Fail closed.
  if (details.length > 3800) throw new Error('Permission request is too large to review safely.');
  let approval = await client.createApproval(config.workspaceId, config.token, {
    channel: config.channel, kind: 'shell', source: `openagents:${config.agentName}`,
    action: `OpenCode requests ${permission.permission} access (once)`, details,
    require_human: true, resume_in_place: true,
  });
  const deadline = Date.now() + timeoutMs;
  while (approval.status === 'pending' && Date.now() < deadline) {
    signal?.throwIfAborted();
    emit?.('approval_wait', { approvalID: approval.id });
    await delay(pollMs, signal);
    approval = await client.getApproval(config.workspaceId, config.token, approval.id);
  }
  signal?.throwIfAborted();
  // Older servers may ignore require_human and auto-approve: NEVER turn that
  // into a grant of a native permission that explicitly requires a person.
  if (approval.status === 'approved' && approval.resolved_by && !['policy', 'token'].includes(approval.resolved_by)) return 'once';
  if (approval.status === 'approved') throw new Error('Workspace server must support human-required tool approvals.');
  return 'reject';
}

async function runServer({ binary, cwd, model, sessionId, prompt, env = process.env, emit,
  approve, signal, startupMs = 30000 }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const password = crypto.randomBytes(32).toString('hex');
  const serverEnv = { ...env, OPENCODE_SERVER_USERNAME: 'openagents', OPENCODE_SERVER_PASSWORD: password };
  // Bridge credentials belong only to this process, not the model's shell.
  delete serverEnv.OPENAGENTS_OPENCODE_BRIDGE;
  const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const kill = () => child.kill();
  controller.signal.addEventListener('abort', kill, { once: true });
  let eventTask;
  let origin;
  try {
    origin = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => finish(new Error('OpenCode server startup timed out')), startupMs);
      const onAbort = () => finish(new Error('OpenCode run stopped'));
      const onError = () => finish(new Error('OpenCode server could not start'));
      const onClose = () => finish(new Error('OpenCode server exited before becoming ready'));
      const onData = d => {
        buffer = (buffer + d.toString()).slice(-8192);
        const m = buffer.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (m) finish(null, m[0]);
      };
      function finish(err, value) {
        clearTimeout(timer);
        child.stdout.off('data', onData); child.stderr.off('data', onData);
        child.off('error', onError); child.off('close', onClose);
        controller.signal.removeEventListener('abort', onAbort);
        if (err) reject(err); else resolve(value);
      }
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.once('error', onError); child.once('close', onClose);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    // Drain server logs without leaking provider credentials into stdout.
    child.stdout.resume(); child.stderr.resume();
    child.once('close', abort);
    const headers = { Authorization: `Basic ${Buffer.from('openagents:' + password).toString('base64')}`,
      'Content-Type': 'application/json' };
    async function request(route, body, requestSignal = controller.signal) {
      const url = new URL(route, origin);
      url.searchParams.set('directory', cwd);
      const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: requestSignal,
      });
      if (!res.ok) throw new Error(`OpenCode server request failed (${res.status})`);
      return res.status === 204 ? null : res.json();
    }
    if (sessionId) await request(`/session/${encodeURIComponent(sessionId)}`);
    else {
      const session = await request('/session', { permission: ['question','plan_enter','plan_exit'].map(permission =>
        ({ permission, action: 'deny', pattern: '*' })) });
      sessionId = session.id;
    }
    if (!sessionId) throw new Error('OpenCode did not create a session');
    emit('session', { sessionID: sessionId });
    const stream = await fetch(`${origin}/event?directory=${encodeURIComponent(cwd)}`, { headers, signal: controller.signal });
    if (!stream.ok || !stream.body) throw new Error('OpenCode event stream unavailable');
    const seen = new Set();
    const pending = new Set();
    let permissionFailure = null;
    let started = false;
    let finish;
    const completed = new Promise((resolve, reject) => {
      finish = resolve;
      controller.signal.addEventListener('abort', () => reject(new Error('OpenCode run stopped or disconnected')), { once: true });
    });
    completed.catch(() => {});
    eventTask = (async () => {
      const decoder = new TextDecoder(); let buffer = '';
      for await (const chunk of stream.body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
        let split;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const data = block.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()).join('\n');
          if (!data) continue;
          const event = JSON.parse(data); const props = event.properties || {};
          if (event.type === 'session.status' && props.sessionID === sessionId) {
            if (props.status?.type === 'busy') started = true;
            if (started && props.status?.type === 'idle') finish();
          }
          if (event.type === 'permission.asked' && props.sessionID === sessionId && !seen.has(props.id)) {
            seen.add(props.id);
            const task = (async () => {
              let reply = 'reject';
              try { reply = await approve(props, controller.signal); }
              catch (e) { permissionFailure = e.message; }
              controller.signal.throwIfAborted();
              await request(`/permission/${encodeURIComponent(props.id)}/reply`, { reply: reply === 'once' ? 'once' : 'reject' });
            })();
            pending.add(task); task.finally(() => pending.delete(task)).catch(() => controller.abort());
          }
          if (event.type === 'session.error' && props.sessionID === sessionId) emit('error', { error: props.error, sessionID: sessionId });
          if (event.type !== 'message.part.updated') continue;
          const part = props.part;
          if (!part || part.sessionID !== sessionId) continue;
          const type = part.type === 'tool' && ['completed','error'].includes(part.state?.status) ? 'tool_use'
            : part.type === 'text' && part.time?.end ? 'text'
            : part.type === 'step-finish' ? 'step_finish' : null;
          if (!type || seen.has(part.id)) continue;
          seen.add(part.id); emit(type, { part, sessionID: sessionId });
        }
      }
      if (!controller.signal.aborted) throw new Error('OpenCode event stream disconnected');
    })();
    eventTask.catch(() => controller.abort());
    const slash = model.indexOf('/');
    if (slash < 1) throw new Error('OpenCode model must include its provider');
    await request(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      model: { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }, parts: [{ type: 'text', text: prompt }],
    });
    await completed;
    await Promise.all(pending);
    const messages = await request(`/session/${encodeURIComponent(sessionId)}/message?limit=1`);
    const result = [...messages].reverse().find(message => message.info?.role === 'assistant');
    // Recover the final text if SSE delivery trails the idle notification.
    for (const part of result?.parts || []) {
      if (part.type === 'text' && !seen.has(part.id)) { seen.add(part.id); emit('text', { part, sessionID: sessionId }); }
    }
    if (result?.info?.error) emit('error', { error: result.info.error, sessionID: sessionId });
    if (permissionFailure) throw new Error(permissionFailure);
    return sessionId;
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', abort);
    if (eventTask) await eventTask.catch(() => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await closed; clearTimeout(timer);
  }
}

if (require.main === module) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  (async () => {
    const config = JSON.parse(process.env.OPENAGENTS_OPENCODE_BRIDGE);
    delete process.env.OPENAGENTS_OPENCODE_BRIDGE;
    let prompt = ''; for await (const chunk of process.stdin) prompt += chunk;
    const emit = (type, data) => process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
    const client = new WorkspaceClient(config.endpoint, { agentName: config.agentName });
    await runServer({ ...config, prompt, emit, signal: controller.signal,
      approve: (permission, signal) => decidePermission(client, config, permission, { signal, emit }) });
  })().catch(() => {
    // Detailed tool errors are emitted in structured events. Do not dump server
    // logs/config/credentials on infrastructure failures.
    process.stdout.write(JSON.stringify({ type: 'error', error: { message: 'OpenCode approval bridge failed or was stopped. Check workspace approval/server availability.' } }) + '\n');
    process.exitCode = 1;
  });
}
module.exports = { runServer, decidePermission };

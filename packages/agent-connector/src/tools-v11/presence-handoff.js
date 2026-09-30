'use strict';
/**
 * Roadmap v1.1 M3/M6 — presence detail + structured agent-to-agent hand-off.
 *
 *   workspace_agent_availability  is <agent> free / busy / offline / runtime down?
 *   workspace_handoff             hand work to another agent with request, context,
 *                                 output so far and next owner travelling together
 *   workspace_get_handoffs        the recent hand-offs in a thread
 *
 * A hand-off is an ordinary `workspace.message.posted` chat message that
 * OPENS with `@<to_agent>` (the backend's deterministic explicit-target path:
 * it routes to exactly that agent and adds it to the thread) and carries the
 * structured record twice — `payload.handoff` for readers of the thread and
 * `metadata.handoff` for routing/analytics — so nothing depends on parsing
 * the markdown back out.
 */

const MAX_HANDOFFS = 10;

const defs = [
  {
    name: 'workspace_agent_availability',
    description:
      'Check whether another agent can take work right now. Returns its status, whether it is busy ' +
      '(and in which threads / how many messages are queued), whether the device it runs on is ' +
      'online, and one reason: available | busy | agent_offline | runtime_offline.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent name (without the openagents: prefix)' },
      },
      required: ['agent'],
    },
  },
  {
    name: 'workspace_handoff',
    description:
      'Hand a piece of work to another agent in the current thread. Posts "@<to_agent> <request>" with ' +
      'optional Context / Output so far / Next owner sections so the request, what it needs, what you ' +
      'already produced and who owns the next step travel together. Only the addressed agent is woken. ' +
      'Use workspace_agent_availability first if timing matters.',
    inputSchema: {
      type: 'object',
      properties: {
        to_agent: { type: 'string', description: 'Agent to hand the work to (name only)' },
        request: { type: 'string', description: 'What you are asking the agent to do — one or two sentences' },
        context: { type: 'string', description: 'Background the agent needs (inputs, constraints, links, file ids)' },
        output: { type: 'string', description: 'What you have already produced (results, paths, partial work)' },
        next_owner: { type: 'string', description: 'Who owns the next step after this (defaults to to_agent)' },
      },
      required: ['to_agent', 'request'],
    },
  },
  {
    name: 'workspace_get_handoffs',
    description:
      'List the most recent structured hand-offs in a thread (newest first, max 10): who handed what to ' +
      'whom, with the context, output and next owner they carried. Defaults to the current thread.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Thread name; omit for the current one' },
        limit: { type: 'integer', description: 'How many to return (1-10, default 10)' },
      },
    },
  },
];

function cleanName(name) {
  return String(name || '').trim().replace(/^@/, '').replace(/^openagents:/, '');
}

function cleanText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return max && s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Build the hand-off record + message content. Pure; exported for tests.
 * Returns { handoff, content } where handoff =
 *   { from, to, request, context, output, next_owner }.
 */
function buildHandoff(from, { to_agent, request, context, output, next_owner } = {}) {
  const to = cleanName(to_agent);
  const req = cleanText(request, 4000);
  if (!to) throw new Error('to_agent is required');
  if (!req) throw new Error('request is required');
  const handoff = {
    from: cleanName(from),
    to,
    request: req,
    context: cleanText(context, 8000),
    output: cleanText(output, 8000),
    next_owner: cleanName(next_owner) || to,
  };
  let content = `@${to} ${req}`;
  if (handoff.context) content += `\n\nContext:\n${handoff.context}`;
  if (handoff.output) content += `\n\nOutput so far:\n${handoff.output}`;
  content += `\n\nNext owner: ${handoff.next_owner}`;
  return { handoff, content };
}

/** The hand-off records found in a list of raw events (newest first). */
function extractHandoffs(events, limit = MAX_HANDOFFS) {
  const out = [];
  for (const e of events || []) {
    const payload = e.payload || {};
    const meta = e.metadata || {};
    const h = (payload.handoff && typeof payload.handoff === 'object') ? payload.handoff
      : (meta.handoff && typeof meta.handoff === 'object') ? meta.handoff : null;
    if (!h) continue;
    out.push({
      id: e.id || null,
      timestamp: e.timestamp || null,
      from: h.from || String(e.source || '').replace(/^openagents:/, ''),
      to: h.to || null,
      request: h.request || null,
      context: h.context || null,
      output: h.output || null,
      next_owner: h.next_owner || h.to || null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function describeAvailability(agent, a) {
  const bits = [`${agent}: ${a.reason || 'unknown'}`];
  bits.push(`status=${a.status || '?'}`);
  if (a.presence_state) bits.push(`presence=${a.presence_state}`);
  if (Array.isArray(a.busy_channels) && a.busy_channels.length) bits.push(`busy in: ${a.busy_channels.join(', ')}`);
  if (a.queue_depth) bits.push(`queued: ${a.queue_depth}`);
  if (a.runtime_status) bits.push(`runtime ${a.runtime_status}${a.runtime_name ? ` (${a.runtime_name})` : ''}`);
  const hint = {
    available: 'It can take work now.',
    busy: 'It will answer after the current run — a hand-off is queued, not lost.',
    agent_offline: 'Its connector is not running; a message will wait until it reconnects.',
    runtime_offline: 'The device it runs on is offline; nobody will pick this up until it is back.',
  }[a.reason];
  return bits.join(' · ') + (hint ? `\n${hint}` : '');
}

async function handle(server, name, args, helpers) {
  const { text } = helpers;
  args = args || {};
  switch (name) {
    case 'workspace_agent_availability': {
      const agent = cleanName(args.agent);
      if (!agent) throw new Error('agent is required');
      const a = await server.ws.getAgentAvailability(server.workspaceId, server.token, agent);
      return text(describeAvailability(agent, a || {}));
    }

    case 'workspace_handoff': {
      const { handoff, content } = buildHandoff(server.agentName, args);
      if (handoff.to === handoff.from) throw new Error('You cannot hand work to yourself');
      const event = {
        type: 'workspace.message.posted',
        source: `openagents:${server.agentName}`,
        target: `channel/${server.channelName}`,
        payload: { content, message_type: 'chat', handoff },
        metadata: { handoff, explicit_targets: [handoff.to] },
      };
      if (server.requesterEmail) event.metadata.requester_email = server.requesterEmail;
      const result = await server.ws.sendEvent(server.workspaceId, event, server.token);
      const targets = (result && result.metadata && result.metadata.target_agents) || [];
      const delivered = targets.includes(handoff.to);
      return text(
        `Handed off to @${handoff.to}${delivered ? '' : ' (warning: the workspace did not route it — is that agent in this workspace?)'}. ` +
        `Next owner: ${handoff.next_owner}. End your turn now unless you have other work; ` +
        `@${handoff.to} will reply in this thread.`,
      );
    }

    case 'workspace_get_handoffs': {
      const channel = args.channel || server.channelName;
      const limit = Math.min(Math.max(1, parseInt(args.limit, 10) || MAX_HANDOFFS), MAX_HANDOFFS);
      const events = await server.ws.getChannelEvents(server.workspaceId, channel, server.token, { limit: 200, sort: 'desc' });
      const handoffs = extractHandoffs(events, limit);
      if (!handoffs.length) return text(`No hand-offs in ${channel} yet.`);
      const lines = handoffs.map((h, i) => {
        const parts = [`${i + 1}. ${h.from || '?'} → ${h.to || '?'}: ${h.request || ''}`];
        if (h.context) parts.push(`   Context: ${h.context}`);
        if (h.output) parts.push(`   Output so far: ${h.output}`);
        if (h.next_owner) parts.push(`   Next owner: ${h.next_owner}`);
        if (h.timestamp) parts.push(`   at ${new Date(h.timestamp).toISOString()}`);
        return parts.join('\n');
      });
      return text(`Hand-offs in ${channel} (newest first):\n${lines.join('\n')}`);
    }

    default:
      return undefined;
  }
}

module.exports = { defs, handle, buildHandoff, extractHandoffs };

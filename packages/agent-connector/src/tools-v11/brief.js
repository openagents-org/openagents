'use strict';
/**
 * v1.1 M5 — the shared work brief.
 *
 * Every thread has one brief (objective, owner, latest result, open
 * questions, next step) that people read instead of scrolling the
 * transcript. Agents keep it current after each meaningful step.
 *
 *   workspace_get_brief    { channel? }
 *   workspace_update_brief { objective?, latest_result?, open_questions?, next_step?, owner? }
 *
 * Only the fields passed to update are changed; the backend records the
 * writer as `openagents:<agent>`.
 */

const defs = [
  {
    name: 'workspace_get_brief',
    description:
      'Read the shared work brief of a thread: objective, owner of the next step, latest result, ' +
      'open questions and next step, plus who directs the thread (director_email). Defaults to the current thread.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Thread id (default: the current thread)' },
      },
    },
  },
  {
    name: 'workspace_update_brief',
    description:
      'Update the current thread\'s shared work brief. Pass only the fields that changed. ' +
      'Call it after each meaningful step so people can see where the work stands without reading the transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'What this thread is trying to achieve (one or two sentences)' },
        latest_result: { type: 'string', description: 'The most recent concrete outcome (what was produced / verified)' },
        open_questions: { type: 'array', items: { type: 'string' }, description: 'Questions blocking or shaping the work. Replaces the list.' },
        next_step: { type: 'string', description: 'The very next action' },
        owner: { type: 'string', description: 'Who owns the next step: "openagents:<agent>" or "human:<email>"' },
      },
    },
  },
];

const FIELDS = ['objective', 'latest_result', 'open_questions', 'next_step', 'owner'];

function renderBrief(b) {
  if (!b) return 'No brief yet.';
  const lines = [`Brief for ${b.channel || 'this thread'}:`];
  if (b.director_email) lines.push(`Directed by: ${b.director_email}`);
  lines.push(`Objective: ${b.objective || '—'}`);
  lines.push(`Owner of next step: ${b.owner || '—'}`);
  lines.push(`Latest result: ${b.latest_result || '—'}`);
  const qs = Array.isArray(b.open_questions) ? b.open_questions : [];
  lines.push(qs.length ? `Open questions:\n${qs.map((q) => `  - ${q}`).join('\n')}` : 'Open questions: —');
  lines.push(`Next step: ${b.next_step || '—'}`);
  if (b.updated_by) lines.push(`Updated by ${b.updated_by}${b.updated_at ? ` at ${b.updated_at}` : ''}`);
  return lines.join('\n');
}

async function handle(server, name, args, helpers) {
  const { text } = helpers;
  args = args || {};

  if (name === 'workspace_get_brief') {
    const channel = (args.channel && String(args.channel).trim()) || server.channelName;
    if (!channel) return text('No thread in scope — pass `channel`.');
    const brief = await server.ws.getBrief(server.workspaceId, server.token, channel);
    return text(renderBrief(brief));
  }

  if (name === 'workspace_update_brief') {
    if (!server.channelName) return text('No thread in scope — the brief belongs to a thread.');
    const fields = {};
    for (const k of FIELDS) {
      if (args[k] === undefined) continue;
      if (k === 'open_questions') {
        fields[k] = Array.isArray(args[k]) ? args[k].map((q) => String(q)) : [];
      } else {
        fields[k] = args[k] === null ? null : String(args[k]);
      }
    }
    if (Object.keys(fields).length === 0) {
      return text('Nothing to update — pass at least one of: ' + FIELDS.join(', ') + '.');
    }
    const brief = await server.ws.putBrief(server.workspaceId, server.token, server.channelName, fields, {
      source: `openagents:${server.agentName}`,
    });
    return text(`Brief updated (${Object.keys(fields).join(', ')}).\n${renderBrief(brief)}`);
  }

  return undefined;
}

module.exports = { defs, handle };

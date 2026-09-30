'use strict';
/**
 * Roadmap v1.1 M3 — escalation to the agent's owner.
 *
 *   workspace_ask_owner          kind=help      blocks like workspace_request_approval
 *   workspace_propose_improvement kind=proposal non-blocking; returns the id
 *
 * Both ride on the approvals table (POST /v1/approvals). The backend routes
 * them to the agent's `owner_email` (inbox row addressed to that person) and
 * posts the request into the thread as an `approval` message. The answer /
 * verdict comes back as a normal human message @mentioning the agent, so an
 * agent that stopped after PENDING is woken through the ordinary poll path.
 *
 * The formatter lives here (not imported from mcp-server.js) to avoid a
 * require cycle: mcp-server.js requires tools-v11/index.js requires this.
 */

const HELP_WAIT_DEFAULT = 300;
const HELP_WAIT_MAX = 900;
const POLL_MS = 3000;

const defs = [
  {
    name: 'workspace_ask_owner',
    description:
      'Ask your owner (the person who set you up and answers for you) a question and wait for the answer. ' +
      'Use it when a teammate\'s request falls outside your owner-reviewed shared instructions, when you hit an ' +
      'exception you are not sure how to handle, or when you need a decision only your owner can make. ' +
      'If nobody owns you, the question goes to the workspace. This call blocks (up to wait_seconds) until an ' +
      'answer arrives and returns it. If it returns PENDING, stop and end your turn — the answer will arrive ' +
      'as a message in this thread @mentioning you.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question, in one or two sentences, phrased so it can be answered directly' },
        details: { type: 'string', description: 'Context the owner needs to answer: what was asked of you, what you tried, the options you see' },
        wait_seconds: { type: 'integer', description: `How long to wait for an answer before returning PENDING (default ${HELP_WAIT_DEFAULT}, max ${HELP_WAIT_MAX})` },
      },
      required: ['question'],
    },
  },
  {
    name: 'workspace_propose_improvement',
    description:
      'Propose a change to your owner-reviewed shared instructions. Use it after a person corrects how you should ' +
      'do recurring work: instead of silently changing your behaviour for everyone, file the correction as a ' +
      'proposal your owner approves. Non-blocking: returns the proposal id immediately; the verdict (✅ Adopted / ' +
      '❌ Not adopted) arrives later as a message in this thread @mentioning you.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One-line summary of the change, e.g. "Always run the eval suite before deploying to HyperPod"' },
        proposal: { type: 'string', description: 'The exact instruction text to add to the shared instructions, written as a rule you will follow' },
      },
      required: ['summary', 'proposal'],
    },
  },
];

function _by(a) {
  if (!a || !a.resolved_by) return null;
  return `${a.resolved_by}${a.resolved_by_role ? ` (${a.resolved_by_role})` : ''}`;
}

function _waitingFor(a) {
  if (a.assignee_email) return `your owner (${a.assignee_email})`;
  if (a.required_role === 'admin') return 'an Admin';
  if (a.required_role === 'owner') return 'the workspace Owner';
  return 'a workspace member';
}

/** What the agent reads back from a help request. Verdict first. */
function formatHelp(a) {
  const q = a.action || a.question || '';
  switch (a.status) {
    case 'approved':
      return `ANSWERED — ${_by(a)} replied to "${q}":\n${a.note || '(no text)'}\nContinue with this answer.\n(request id: ${a.id})`;
    case 'rejected':
      return `DECLINED — ${_by(a)} declined to answer "${q}".${a.note ? `\nNote: ${a.note}` : ''}\nDo not guess; say in the thread what you were unsure about and stop.\n(request id: ${a.id})`;
    case 'expired':
      return `EXPIRED — nobody answered "${q}" in time. Do not guess; say in the thread what you were unsure about and stop.\n(request id: ${a.id})`;
    default:
      return `PENDING — "${q}" was sent to ${_waitingFor(a)}. Stop here and end your turn; the answer will arrive as a new message in this thread (@mentioning you), or call workspace_check_approval with id ${a.id} later.`;
  }
}

/** What the agent reads back right after filing a proposal. */
function formatProposal(a) {
  const s = a.action || '';
  switch (a.status) {
    case 'approved':
      return `ADOPTED — "${s}" was approved by ${_by(a)} and added to your shared instructions.${a.note ? `\nNote: ${a.note}` : ''}\n(proposal id: ${a.id})`;
    case 'rejected':
      return `NOT ADOPTED — "${s}" was declined by ${_by(a)}.${a.note ? `\nNote: ${a.note}` : ''} Keep following the current shared instructions.\n(proposal id: ${a.id})`;
    case 'expired':
      return `EXPIRED — nobody reviewed "${s}". Keep following the current shared instructions.\n(proposal id: ${a.id})`;
    default:
      return `PROPOSED — "${s}" was sent to ${_waitingFor(a)} for review. Carry on with your current work; the verdict (✅ Adopted / ❌ Not adopted) will arrive as a message in this thread.\n(proposal id: ${a.id})`;
  }
}

function _common(server) {
  const body = {
    channel: server.channelName,
    source: `openagents:${server.agentName}`,
  };
  if (server.requesterEmail) body.requester_email = server.requesterEmail;
  return body;
}

async function handle(server, name, args, helpers) {
  const text = helpers.text;
  args = args || {};
  switch (name) {
    case 'workspace_ask_owner': {
      const question = String((args && args.question) || '').trim();
      if (!question) throw new Error('question is required');
      // 0 is a real choice ("file it and return"), so only a missing or
      // non-numeric value falls back to the default.
      const raw = args.wait_seconds;
      const waitSec = (raw === undefined || raw === null || raw === '' || !Number.isFinite(Number(raw)))
        ? HELP_WAIT_DEFAULT
        : Math.max(0, Math.min(HELP_WAIT_MAX, Number(raw)));
      let a = await server.ws.askOwner(server.workspaceId, server.token, {
        ..._common(server),
        question,
        details: args.details,
      });
      const deadline = Date.now() + waitSec * 1000;
      while (a && a.status === 'pending' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        try {
          a = await server.ws.getApproval(server.workspaceId, server.token, a.id);
        } catch (e) {
          if (server._log) server._log(`ask_owner poll failed: ${e.message}`);
        }
      }
      return text(formatHelp(a));
    }

    case 'workspace_propose_improvement': {
      const summary = String((args && args.summary) || '').trim();
      const proposal = String((args && args.proposal) || '').trim();
      if (!summary) throw new Error('summary is required');
      if (!proposal) throw new Error('proposal is required');
      const a = await server.ws.proposeImprovement(server.workspaceId, server.token, {
        ..._common(server),
        summary,
        proposal,
      });
      return text(formatProposal(a));
    }

    default:
      return undefined;
  }
}

module.exports = { defs, handle, formatHelp, formatProposal };

'use strict';

/**
 * Browser base URL for a workspace API endpoint.
 *
 * - Hosted: https://workspace-endpoint[-x].openagents.org -> https://workspace[-x].openagents.org
 * - Self-hosted bundle (workspace/selfhost): the API lives under /api on the
 *   same origin as the web app, so https://agents.example.com/api -> https://agents.example.com
 * - localhost / anything else: the endpoint itself (a dev backend next to its web app).
 */
const HOSTED_WEB = 'https://workspace.openagents.org';

function workspaceWebBase(endpoint) {
  const ep = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!ep) return HOSTED_WEB;
  let url;
  try { url = new URL(ep); } catch { return HOSTED_WEB; }
  if (/^workspace-endpoint(-[a-z0-9-]+)?\.openagents\.org$/i.test(url.hostname)) {
    return `https://${url.hostname.replace(/^workspace-endpoint/i, 'workspace')}`;
  }
  if (/\/api$/i.test(url.pathname)) return ep.replace(/\/api$/i, '');
  return ep.replace(/\/v1$/i, '');
}

function workspaceWebUrl(slug, endpoint) {
  return `${workspaceWebBase(endpoint)}/${slug}`;
}

module.exports = { workspaceWebBase, workspaceWebUrl, HOSTED_WEB };

import { execSync } from 'node:child_process';

import { REQUIRED_HOST_API } from './host-api';

/**
 * Writes `bundle-info.json` beside the desktop build's index.html: which
 * commit this is, when that commit was made, and the launcher bridge it needs.
 *
 * The launcher reads it both from the bundle it ships and from bundles it
 * downloads later (packages/launcher/src/main/bundle-ota), and only switches
 * to a download whose source is newer than the bundle it already has. That
 * ordering is by COMMIT time, not build time: re-running an old publish, or
 * building an old tag today, must not count as an upgrade. The publish script
 * signs the same fields, so the file and the manifest have to agree.
 */

const SCHEMA = 1;

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/** 20261120.081500-2c6974a — sortable, and safe as a folder name. */
function versionOf(committedAt: number, commit: string): string {
  const stamp = new Date(committedAt).toISOString().replace(/[-:]/g, '').replace('T', '.').slice(0, 15);
  return `${stamp}-${commit.slice(0, 7).replace(/[^0-9A-Za-z]/g, '') || 'local'}`;
}

interface EmitContext {
  emitFile(file: { type: 'asset'; fileName: string; source: string }): string;
}

/** A Vite plugin; typed structurally so `next build` need not resolve Vite's types. */
export function bundleInfo() {
  return {
    name: 'openagents-bundle-info',
    apply: 'build' as const,
    generateBundle(this: EmitContext) {
      const commit = process.env.WORKSPACE_BUNDLE_COMMIT || process.env.GITHUB_SHA || git('rev-parse HEAD') || 'local';
      // Committer time: on openagents-release every commit is a promotion
      // merge, made in the order the branch moves. Outside a checkout there is
      // no commit to date, and only a local build gets that far.
      const seconds = /^[0-9a-f]{7,40}$/i.test(commit) ? Number(git(`show -s --format=%ct ${commit}`)) : NaN;
      const committedAt = Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
      const info = { schema: SCHEMA, version: versionOf(committedAt, commit), commit, committedAt, minHostApi: REQUIRED_HOST_API };
      this.emitFile({ type: 'asset', fileName: 'bundle-info.json', source: `${JSON.stringify(info, null, 2)}\n` });
    },
  };
}

#!/usr/bin/env bash
set -euo pipefail

# Preview shares live production data. Sync only the dedicated beta branch.
repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
if [[ "$(git -C "$repo_root" branch --show-current)" != "codex/preview" ]]; then
  echo "Switch to codex/preview before deploying preview features." >&2
  exit 1
fi

# The preview mounts this source tree and runs next dev. No build or restart.
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../frontend" && pwd)"
rsync -rcz --itemize-changes \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env*' --exclude next-env.d.ts --exclude '*.tsbuildinfo' --exclude '*.log' \
  "$source_dir/" \
  root@164.92.127.159:/opt/openagents-preview/repo/workspace/frontend/

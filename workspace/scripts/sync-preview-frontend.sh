#!/usr/bin/env bash
set -euo pipefail

# Preview shares live production data. Sync only the dedicated beta branch.
repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
if [[ "$(git -C "$repo_root" branch --show-current)" != "codex/preview" ]]; then
  echo "Switch to codex/preview before deploying preview features." >&2
  exit 1
fi

# Keep editable sources on the host, but serve a compiled build. Development
# bundles made first visits appear stuck while downloading/hydrating.
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../frontend" && pwd)"
rsync -rcz --itemize-changes \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env*' --exclude next-env.d.ts --exclude '*.tsbuildinfo' --exclude '*.log' \
  "$source_dir/" \
  root@164.92.127.159:/opt/openagents-preview/repo/workspace/frontend/

release_id="$(git -C "$repo_root" rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
ssh root@164.92.127.159 bash -s -- "$release_id" \
  < "$repo_root/workspace/scripts/deploy-preview-frontend.sh"

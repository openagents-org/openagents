#!/usr/bin/env bash
set -euo pipefail

# The preview mounts this source tree and runs next dev. No build or restart.
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../frontend" && pwd)"
rsync -rcz --itemize-changes \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env*' --exclude next-env.d.ts --exclude '*.tsbuildinfo' --exclude '*.log' \
  "$source_dir/" \
  root@164.92.127.159:/opt/openagents-preview/repo/workspace/frontend/

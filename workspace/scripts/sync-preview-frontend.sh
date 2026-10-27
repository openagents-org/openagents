#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'Preview now deploys frontend + backend from develop with its own local database.'
printf '%s\n' 'Use: gh workflow run deploy-preview.yml --repo openagents-org/openagents --ref develop'
exit 1

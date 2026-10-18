#!/usr/bin/env bash
# Runs on the preview host, called by sync-preview-frontend.sh.
set -euo pipefail
release_id="${1:?Pass a release ID}"
[[ "$release_id" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
cd /opt/openagents-preview
exec 9>/opt/openagents-preview/frontend-deploy.lock
flock -n 9 || { echo 'Another frontend deployment is running.' >&2; exit 1; }
image="openagents-preview-frontend:$release_id"
candidate="preview-frontend-check-$release_id"
backup="backups/frontend-$release_id"
mkdir -p "$backup"
cp docker-compose.yml "$backup/docker-compose.yml"

docker build --memory=2560m --memory-swap=2560m \
  --build-arg NEXT_PUBLIC_API_URL=https://workspace-preview.openagents.org \
  --build-arg NEXT_PUBLIC_FIRST_PARTY_HOSTNAMES=workspace-preview.openagents.org \
  --build-arg NEXT_PUBLIC_INLINE_LOGIN=1 \
  -t "$image" repo/workspace/frontend

switched=false
cleanup() {
  result=$?
  trap - EXIT
  docker rm -f "$candidate" >/dev/null 2>&1 || true
  if [[ $result != 0 && "$switched" == true ]]; then
    cp "$backup/docker-compose.yml" docker-compose.yml
    docker compose up -d --no-deps --no-build frontend
    docker compose exec -T nginx nginx -s reload
    echo "Deployment failed; restored $backup/docker-compose.yml" >&2
  fi
  exit "$result"
}
trap cleanup EXIT
docker run -d --name "$candidate" -e NODE_ENV=production \
  -p 127.0.0.1::3000 "$image" >/dev/null
port="$(docker port "$candidate" 3000/tcp | cut -d: -f2)"
curl --fail --silent --show-error --retry 15 --retry-connrefused --retry-delay 1 \
  "http://127.0.0.1:$port/login" >/dev/null

# Replace only the frontend service. In particular, preserve the deployed
# backend image, protected environment, disabled jobs, and database settings.
python3 - "$image" <<'PY'
from pathlib import Path
import sys
path = Path('docker-compose.yml')
text = path.read_text()
start = text.index('\n  frontend:\n')
end = text.index('\n  nginx:\n', start)
frontend = f'''
  frontend:
    image: {sys.argv[1]}
    environment:
      NODE_ENV: production
      NEXT_TELEMETRY_DISABLED: '1'
    depends_on:
      - backend
    restart: unless-stopped
'''
path.write_text(text[:start] + frontend + text[end:])
PY
switched=true
docker compose config --quiet
docker compose up -d --no-deps --no-build frontend
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
curl --fail --silent --show-error --retry 15 --retry-all-errors --retry-delay 1 \
  -H 'Host: workspace-preview.openagents.org' http://127.0.0.1/login >/dev/null
echo "Preview frontend deployed: $image; rollback configuration: $backup/docker-compose.yml"

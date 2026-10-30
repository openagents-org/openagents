#!/usr/bin/env python3
"""One-time host setup. Run as root after copying this directory to the host.

Never copies production data, storage keys, model keys, push credentials or
session-signing secrets. Reuses only public login-provider configuration.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess

ROOT = Path('/opt/openagents-preview-isolated')
SOURCE = Path(__file__).resolve().parent


def write_private(path, content):
    if path.exists():
        return
    path.write_text(content)
    path.chmod(0o600)


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    ROOT.mkdir(mode=0o755, exist_ok=True)
    (ROOT / 'secrets').mkdir(mode=0o700, exist_ok=True)
    (ROOT / 'backups').mkdir(mode=0o700, exist_ok=True)
    password = secrets.token_hex(32)
    write_private(ROOT / 'secrets/postgres.env',
                  'POSTGRES_USER=openagents_preview\nPOSTGRES_DB=openagents_preview\n'
                  f'POSTGRES_PASSWORD={password}\n')
    values = dict(line.split('=', 1) for line in (ROOT / 'secrets/postgres.env').read_text().splitlines())
    write_private(ROOT / '.env',
                  'PREVIEW_SHA=8e8156a4dca0e55f9f41650af138ea294cf75978\n'
                  'PREVIEW_HTTP_BIND=127.0.0.1:8081\n'
                  f'PREVIEW_DATABASE_URL=postgresql://openagents_preview:{values["POSTGRES_PASSWORD"]}@postgres:5432/openagents_preview\n')
    if not (ROOT / 'secrets/backend.env').exists():
        result = subprocess.run(['docker', 'inspect', 'openagents-preview-backend-1'],
                                check=True, capture_output=True, text=True)
        old = dict(item.split('=', 1) for item in json.loads(result.stdout)[0]['Config']['Env'] if '=' in item)
        public_auth = {k: old[k] for k in ('AUTH_MODE', 'FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY', 'APPLE_CLIENT_IDS') if k in old}
        public_auth.update(WORKSPACE_SESSION_SECRET=secrets.token_hex(48), YUMI_ENABLED='false',
                           ROUTER_LLM_ENABLED='false', ANALYTICS_ENABLED='false', CAMPAIGN_ENABLED='false',
                           ENFORCE_AGENT_LIFECYCLE_AUTH='true')
        write_private(ROOT / 'secrets/backend.env', ''.join(f'{k}={v}\n' for k, v in public_auth.items()))
    for name in ('compose.yml',):
        shutil.copy2(SOURCE / name, ROOT / name)
    for name in ('nginx.conf', 'proxy_headers.inc'):
        shutil.copy2(Path('/opt/openagents-preview') / name, ROOT / name)
    shutil.copy2(SOURCE / 'deploy.py', '/usr/local/sbin/openagents-preview-deploy')
    Path('/usr/local/sbin/openagents-preview-deploy').chmod(0o755)
    shutil.copy2(SOURCE / 'track_develop.py', '/usr/local/sbin/openagents-preview-track-develop')
    Path('/usr/local/sbin/openagents-preview-track-develop').chmod(0o755)
    for name in ('openagents-preview-develop.service', 'openagents-preview-develop.timer'):
        shutil.copy2(SOURCE / name, Path('/etc/systemd/system') / name)
    Path('/var/lib/openagents-preview/incoming').mkdir(parents=True, exist_ok=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    print('Provisioned isolated preview config, local DB credentials and develop tracking service.')


if __name__ == '__main__':
    main()

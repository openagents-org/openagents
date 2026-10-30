#!/usr/bin/env python3
"""Deploy an exact preview branch build using only this droplet's isolated preview data."""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import urlparse

ROOT = Path('/opt/openagents-preview-isolated')
INCOMING = Path('/var/lib/openagents-preview/incoming')


def require_sha(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('Expected a full Git commit SHA')
    return value


def read_env(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if line and not line.startswith('#'))


def require_isolated(config):
    url = urlparse(config.get('PREVIEW_DATABASE_URL', ''))
    if (url.scheme != 'postgresql' or url.hostname != 'postgres' or
            url.path != '/openagents_preview' or url.username != 'openagents_preview' or
            url.port not in (None, 5432)):
        raise ValueError('Deployment must use the dedicated local preview database')


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def compose(*args, capture=False):
    return run(['docker', 'compose', '--project-directory', str(ROOT),
                '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'compose.yml'), *args],
               stdout=subprocess.PIPE if capture else None, text=capture)


def set_revision(config, sha):
    config = {**config, 'PREVIEW_SHA': sha}
    temp = ROOT / '.env.new'
    temp.write_text(''.join(f'{key}={value}\n' for key, value in config.items()))
    temp.chmod(0o600)
    temp.replace(ROOT / '.env')


def image_ok(image, sha):
    result = run(['docker', 'image', 'inspect', image], capture_output=True, text=True)
    data = json.loads(result.stdout)[0]
    if data.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != sha:
        raise ValueError(f'Unexpected revision label for {image}')


def verify():
    compose('exec', '-T', 'backend', 'python', '-c',
            'from urllib.request import urlopen; import json; '
            'assert json.load(urlopen("http://127.0.0.1:8000/ready", timeout=10))["database"] == "ok"')
    # Ask nginx, including after replacing upstream containers: Docker DNS is
    # resolved on reload and old backend IPs must not linger in nginx.
    compose('exec', '-T', 'nginx', 'nginx', '-t')
    compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload')
    for attempt in range(30):
        try:
            compose('exec', '-T', 'nginx', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1/login')
            compose('exec', '-T', 'nginx', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1/ready')
            return
        except subprocess.CalledProcessError:
            if attempt == 29:
                raise
            time.sleep(2)


def deploy(sha):
    require_sha(sha)
    config = read_env(ROOT / '.env')
    require_isolated(config)
    previous = config.get('PREVIEW_SHA')
    archive = INCOMING / f'{sha}.tar.gz'
    if archive.is_symlink() or not archive.is_file():
        raise ValueError('Missing regular build archive')
    backup_dir = ROOT / 'backups' / f'{time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())}-{sha[:12]}'
    backup_dir.mkdir(parents=True, mode=0o700)
    shutil.copy2(ROOT / '.env', backup_dir / 'deployment.env')
    shutil.copy2(ROOT / 'compose.yml', backup_dir / 'compose.yml')
    # Use argv and stdin, never interpolate a remote SHA into shell code.
    with archive.open('rb') as source:
        run(['docker', 'load'], stdin=source)
    for image in (f'openagents-preview-backend:{sha}', f'openagents-preview-frontend-develop:{sha}'):
        image_ok(image, sha)
    compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres')
    with (backup_dir / 'database.dump').open('wb') as target:
        run(['docker', 'compose', '--project-directory', str(ROOT), '--env-file', str(ROOT / '.env'),
             '-f', str(ROOT / 'compose.yml'), 'exec', '-T', 'postgres', 'pg_dump',
             '-U', 'openagents_preview', '-d', 'openagents_preview', '-Fc'], stdout=target)
    set_revision(config, sha)
    # Always stop application writers before a schema migration. A failed
    # migration stays stopped until the backup is restored; never downgrade.
    compose('stop', 'backend', 'frontend')
    try:
        compose('run', '--rm', '--no-deps', '--entrypoint', 'alembic', 'backend', 'upgrade', 'head')
        compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'backend', 'frontend', 'nginx')
        verify()
    except Exception:
        compose('stop', 'backend', 'frontend')
        # Restore only this stack's DB, with all app writers stopped.
        compose('exec', '-T', 'postgres', 'psql', '-U', 'openagents_preview', '-d', 'openagents_preview',
                '-v', 'ON_ERROR_STOP=1', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
        with (backup_dir / 'database.dump').open('rb') as source:
            run(['docker', 'compose', '--project-directory', str(ROOT), '--env-file', str(ROOT / '.env'),
                 '-f', str(ROOT / 'compose.yml'), 'exec', '-T', 'postgres', 'pg_restore',
                 '-U', 'openagents_preview', '-d', 'openagents_preview', '--clean', '--if-exists',
                 '--no-owner', '--exit-on-error'], stdin=source)
        shutil.copy2(backup_dir / 'deployment.env', ROOT / '.env')
        if previous:
            compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'backend', 'frontend', 'nginx')
            verify()
        raise
    result = {'revision': sha, 'status': 'deployed', 'database': 'local:openagents_preview',
              'backup': str(backup_dir), 'deployed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    temp = ROOT / 'deployed.json.new'
    temp.write_text(json.dumps(result, indent=2) + '\n')
    temp.replace(ROOT / 'deployed.json')
    print(json.dumps(result))
    # Incoming build archives are large; keep the deployed and last predecessor.
    archives = sorted(INCOMING.glob('*.tar.gz'), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in archives[2:]:
        old.unlink()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: openagents-preview-deploy FULL_SHA')
    require_sha(sys.argv[1])
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / 'deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy(sys.argv[1])

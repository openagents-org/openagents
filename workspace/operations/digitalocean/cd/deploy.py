#!/usr/bin/env python3
"""Root-owned forced SSH command; all credentials/configuration stay on the host."""
import contextlib
import fcntl
import gzip
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
from rollout import rollout

ROOT = Path('/opt/openagents')
CD = ROOT / 'cd'
SHA = re.compile(r'^[0-9a-f]{40}$')
IMAGE = re.compile(r'^openagents-backend:(?:release-[0-9a-f]{40}|v11-[0-9a-f]{9})$')


def config():
    return json.loads((CD / 'config.json').read_text())


def write_private(path, value):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(value)
    tmp.chmod(0o600)
    tmp.replace(path)


def command(args, timeout=300, input=None, capture=False):
    # Output may contain connection strings or migration parameters. It stays
    # in a root-only server log and never travels to Actions on a failure.
    result = subprocess.run(args, cwd=ROOT, input=input, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    with (CD / 'operations.log').open('ab') as log:
        log.write(result.stdout); log.write(result.stderr)
    if result.returncode:
        raise RuntimeError('Server command failed; inspect private deployment log')
    return result.stdout.decode() if capture else None


@contextlib.contextmanager
def lock(name):
    with (CD / (name + '.lock')).open('w') as file:
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def ready(url='http://127.0.0.1:8000/ready'):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'curl/8.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status == 200
    except Exception:
        return False


def status():
    image = command(['docker', 'inspect', '-f', '{{.Config.Image}}',
                     'openagents-backend-1'], capture=True).strip()
    return {'image': image, 'ready': ready()}


def validate(image):
    if not IMAGE.fullmatch(image):
        raise ValueError('Invalid image reference')
    revision = command(['docker', 'image', 'inspect', '-f',
                        '{{index .Config.Labels "org.opencontainers.image.revision"}}',
                        image], capture=True).strip()
    if ':release-' in image and revision != image.split(':release-')[1]:
        raise ValueError('Image revision does not match release')


def stage(sha):
    if not SHA.fullmatch(sha):
        raise ValueError('Invalid commit')
    image = 'openagents-backend:release-' + sha
    with lock('stage'):
        # Gzip is decoded into a private temporary archive with a size limit.
        # Docker handles its own image format; no shell or arbitrary tar extraction.
        archive = CD / 'incoming-image.tar'
        try:
            with gzip.GzipFile(fileobj=sys.stdin.buffer) as source, archive.open('wb') as target:
                total = 0
                while chunk := source.read(1024 * 1024):
                    total += len(chunk)
                    if total > 3 * 1024**3:
                        raise ValueError('Image archive exceeds limit')
                    target.write(chunk)
            command(['docker', 'load', '-i', str(archive)], timeout=600)
            validate(image)
        finally:
            archive.unlink(missing_ok=True)
    return {'staged': sha}


def route(mode):
    cfg = config()
    address = cfg['local_upstream'] if mode == 'local' else cfg['peer_upstream']
    if mode not in ('local', 'peer') or not re.fullmatch(r'[0-9.:]+', address):
        raise ValueError('Invalid routing target')
    path = Path(cfg['upstream_file']); old = path.read_text()
    new = re.sub(r'server\s+[0-9.:]+;', 'server ' + address + ';', old)
    if new == old:
        return
    path.write_text(new)
    try:
        command(['nginx', '-t'])
        command(['systemctl', 'reload', 'nginx'])
    except Exception:
        path.write_text(old)
        raise


def activate(image):
    import yaml
    validate(image)
    with lock('activate'):
        path = ROOT / 'compose.yml'
        old = path.read_text()
        write_private(CD / 'compose-before.yml', old)
        data = yaml.safe_load(old)
        data['services']['backend']['image'] = image
        write_private(path, yaml.safe_dump(data, sort_keys=False))
        command(['docker', 'compose', '--profile', 'production', 'up', '-d',
                 '--no-deps', '--timeout', '25', 'backend'], timeout=180)
        deadline = time.monotonic() + 120
        consecutive = 0
        while time.monotonic() < deadline:
            consecutive = consecutive + 1 if ready() else 0
            if consecutive >= 3:
                return status()
            time.sleep(2)
        raise RuntimeError('Candidate readiness failed')


def verify(public=False):
    cfg = config()
    base = cfg['public_url'] if public else 'http://127.0.0.1:8000'
    if not ready(base + '/ready'):
        raise RuntimeError('Readiness failed')
    if not public:
        # Treat shared-cache failure as a failed deployment, even though the
        # application can fall back to SQL during an ordinary cache outage.
        command(['docker', 'exec', 'openagents-backend-1', 'python', '-c',
                 'from app import cache; c=cache._lazy_client(); assert c is not None and c.ping()'])
    smoke = json.loads((CD / 'secrets/smoke.json').read_text())
    from urllib.parse import urlencode
    query = urlencode({'network': smoke['workspace'], 'limit': 1})
    req = urllib.request.Request(base + '/v1/events?' + query,
        headers={'User-Agent': 'curl/8.0', 'X-Workspace-Token': smoke['token']})
    with urllib.request.urlopen(req, timeout=15) as response:
        body = json.load(response)
        if response.status != 200 or not isinstance(body.get('data', {}).get('events'), list):
            raise RuntimeError('Authenticated smoke check failed')
    return {'verified': True}


class Node:
    def __init__(self, name, cfg, remote=False):
        self.name, self.cfg, self.remote = name, cfg, remote
        self.id = cfg['peer_droplet_id'] if remote else cfg['droplet_id']

    def rpc(self, verb, arg=None):
        if not self.remote:
            return dispatch('peer', [verb] + ([arg] if arg else []))
        args = ['ssh', '-i', str(CD / 'secrets/peer-key'), '-o', 'BatchMode=yes',
                '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(CD / 'peer-known-hosts'),
                '-o', 'ConnectTimeout=10', 'root@' + self.cfg['peer_host'],
                ' '.join([verb] + ([arg] if arg else []))]
        return json.loads(command(args, capture=True, timeout=300))

    def status(self): return self.rpc('status')
    def validate(self, image): return self.rpc('validate', image)
    def activate(self, image): return self.rpc('activate', image)
    def route(self, mode): return self.rpc('route', mode)
    def verify(self): return self.rpc('verify')


class Balancer:
    def __init__(self, cfg): self.cfg = cfg

    def api(self, suffix='', method='GET', body=None):
        token = Path(self.cfg['do_token_file']).read_text().strip()
        req = urllib.request.Request('https://api.digitalocean.com/v2/load_balancers/' + self.cfg['load_balancer_id'] + suffix,
             method=method, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
             data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
        return json.loads(raw) if raw else {}

    def contains_all(self, nodes):
        actual = set(self.api()['load_balancer']['droplet_ids'])
        return actual == {n.id for n in nodes}

    def remove(self, node):
        ids = self.api()['load_balancer']['droplet_ids']
        if node.id in ids:
            if len(ids) < 2:
                raise RuntimeError('Refusing to remove last backend')
            self.api('/droplets', 'DELETE', {'droplet_ids': [node.id]})

    def add(self, node):
        if node.id not in self.api()['load_balancer']['droplet_ids']:
            self.api('/droplets', 'POST', {'droplet_ids': [node.id]})


def migration_command(image, *args):
    return ['docker', 'run', '--rm', '--network', config()['migration_network'],
            '--env-file', str(CD / 'secrets/migration.env'),
            '-v', str(CD / 'migration_plan.py') + ':/ops/migration_plan.py:ro',
            '--entrypoint', 'python', image, *args]


def migrate(image):
    plan = json.loads(command(migration_command(image, '/ops/migration_plan.py'), capture=True))
    if not plan['pending']:
        if plan['current'] != plan['target']:
            raise RuntimeError('Schema revision does not match target')
        write_private(CD / 'migration-last.json', json.dumps(plan))
        return
    if plan['pending']:
        command(['python3', str(CD / 'backup.py')], timeout=1800)
    command(migration_command(image, '-m', 'alembic', 'upgrade', 'head'), timeout=900)
    after = json.loads(command(migration_command(image, '/ops/migration_plan.py'), capture=True))
    if after['pending'] or after['current'] != plan['target']:
        raise RuntimeError('Schema did not reach target revision')
    write_private(CD / 'migration-last.json', json.dumps(after))


def deploy(sha):
    if not SHA.fullmatch(sha): raise ValueError('Invalid commit')
    cfg = config()
    if not cfg['coordinator']: raise ValueError('Deploy requires coordinator')
    with lock('deployment'):
        image = 'openagents-backend:release-' + sha
        nodes = [Node('secondary', cfg, True), Node('primary', cfg)]
        def record(result):
            result.update(release=sha, timestamp=time.time())
            write_private(CD / 'last-result.json', json.dumps(result))
            write_private(CD / ('result-' + sha + '.json'), json.dumps(result))
        rollout(nodes, Balancer(cfg), image, lambda: migrate(image),
                lambda: verify(public=True), record,
                lambda phase: time.sleep(15 if phase == 'drain' else 35))
        return {'deployed': sha}


def start_deploy(sha):
    if not SHA.fullmatch(sha) or not config()['coordinator']:
        raise ValueError('Invalid coordinator deployment')
    with lock('dispatch'):
        active = subprocess.run(['systemctl', 'is-active', '--quiet', 'openagents-auto-deploy.service'])
        if active.returncode == 0:
            raise RuntimeError('A deployment is already running')
        write_private(CD / ('result-' + sha + '.json'), json.dumps({'status': 'running', 'release': sha}))
        command(['systemd-run', '--unit=openagents-auto-deploy', '--collect',
                 '--property=RuntimeMaxSec=3600',
                 '--property=StandardOutput=append:' + str(CD / 'operations.log'),
                 '--property=StandardError=append:' + str(CD / 'operations.log'),
                 sys.executable, str(CD / 'deploy.py'), 'run', sha])
    return {'status': 'running', 'release': sha}


def deployment_result(sha):
    if not SHA.fullmatch(sha): raise ValueError('Invalid commit')
    result = json.loads((CD / ('result-' + sha + '.json')).read_text())
    if result['status'] == 'running':
        active = subprocess.run(['systemctl', 'is-active', '--quiet', 'openagents-auto-deploy.service'])
        if active.returncode != 0:
            result['status'] = 'interrupted'
    return result


def dispatch(role, words):
    if not words: raise ValueError('Missing command')
    verb, *args = words
    if verb == 'status' and not args: return status()
    if role == 'ci' and verb == 'stage' and len(args) == 1: return stage(args[0])
    if role == 'ci' and verb == 'deploy' and len(args) == 1: return start_deploy(args[0])
    if role == 'ci' and verb == 'result' and len(args) == 1: return deployment_result(args[0])
    if role == 'peer':
        if verb == 'validate' and len(args) == 1: validate(args[0]); return {'valid': True}
        if verb == 'route' and len(args) == 1: route(args[0]); return {'routed': args[0]}
        if verb == 'activate' and len(args) == 1: return activate(args[0])
        if verb == 'verify' and not args: return verify()
    raise ValueError('Command not allowed for this key')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        role = sys.argv[1]
        if role == 'run' and len(sys.argv) == 3:
            sha = sys.argv[2]
            try:
                print(json.dumps(deploy(sha)), flush=True)
            except Exception:
                path = CD / ('result-' + sha + '.json')
                if json.loads(path.read_text())['status'] == 'running':
                    write_private(path, json.dumps({'status': 'failed', 'release': sha}))
                raise
            sys.exit(0)
        if role not in ('ci', 'peer'): raise ValueError('Invalid role')
        # SSH_ORIGINAL_COMMAND is untrusted; parse tokens, never run a shell.
        words = shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
        print(json.dumps(dispatch(role, words)), flush=True)
    except Exception as exc:
        import traceback
        with (CD / 'operations.log').open('a') as log:
            traceback.print_exc(file=log)
        # No exception text/traceback in SSH output: libraries can include secrets.
        print(json.dumps({'error': type(exc).__name__, 'detail': 'Deployment command failed; inspect private server logs'}), flush=True)
        sys.exit(1)

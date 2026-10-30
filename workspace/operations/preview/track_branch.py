#!/usr/bin/env python3
"""Poll a public branch (beta by default) and build/deploy the same SHA. No GitHub token required."""
import fcntl
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time

ROOT = Path('/opt/openagents-preview-isolated')
REPO = ROOT / 'source.git'
URL = 'https://github.com/openagents-org/openagents.git'


def require_branch(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,99}', value) or '..' in value:
        raise ValueError('Invalid preview branch')
    return value


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    with (ROOT / 'tracker.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('A preview build is already running.')
            return
        branch = require_branch(os.environ.get('PREVIEW_BRANCH', 'beta'))
        os.environ['GIT_TERMINAL_PROMPT'] = '0'
        if not REPO.exists():
            run(['git', 'init', '--bare', str(REPO)])
        run(['git', '-C', str(REPO), '-c', 'credential.helper=', 'fetch', '--depth=1', URL,
             f'+refs/heads/{branch}:refs/heads/{branch}'])
        sha = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', f'refs/heads/{branch}'], text=True).strip()
        if len(sha) != 40 or any(ch not in '0123456789abcdef' for ch in sha):
            raise ValueError(f'Invalid {branch} revision')
        deployed_file = ROOT / 'deployed.json'
        if deployed_file.exists() and json.loads(deployed_file.read_text()).get('revision') == sha:
            print(f'Preview already tracks {branch} {sha}.')
            return
        failure_file = ROOT / 'build-failed.json'
        if failure_file.exists() and '--retry' not in sys.argv:
            failure = json.loads(failure_file.read_text())
            if failure.get('revision') == sha and time.time() - failure.get('time', 0) < 1800:
                print(f'Build {sha} failed recently; retrying after 30 minutes or a new commit.')
                return
        build = ROOT / 'build'
        shutil.rmtree(build, ignore_errors=True)
        build.mkdir()
        print(f'Building preview from {branch} {sha}', flush=True)
        try:
            # git archive contains tracked sources only, never host env files.
            archive = ROOT / 'source.tar'
            with archive.open('wb') as output:
                run(['git', '-C', str(REPO), 'archive', sha], stdout=output)
            with tarfile.open(archive) as source:
                # Python 3.12's data filter rejects absolute paths/symlinks
                # escaping the build root while supporting normal repo links.
                source.extractall(build, filter='data')
            archive.unlink()
            backend = f'openagents-preview-backend:{sha}'
            frontend = f'openagents-preview-frontend-develop:{sha}'
            run(['docker', 'build', '--memory=2560m', '--memory-swap=2560m',
                 '-f', str(build / 'workspace/backend/production.Dockerfile'),
                 '--build-arg', f'RELEASE_SHA={sha}', '-t', backend,
                 str(build / 'workspace/backend')])
            run(['docker', 'build', '--memory=2560m', '--memory-swap=2560m',
                 '--build-arg', 'NEXT_PUBLIC_API_URL=https://workspace-preview.openagents.org',
                 '--build-arg', 'NEXT_PUBLIC_FIRST_PARTY_HOSTNAMES=workspace-preview.openagents.org',
                 '--build-arg', 'NEXT_PUBLIC_INLINE_LOGIN=1',
                 '--label', f'org.opencontainers.image.revision={sha}',
                 '-t', frontend, str(build / 'workspace/frontend')])
            incoming = Path('/var/lib/openagents-preview/incoming')
            incoming.mkdir(parents=True, exist_ok=True)
            target = incoming / f'{sha}.tar.gz'
            with target.open('wb') as output:
                save = subprocess.Popen(['docker', 'save', backend, frontend], stdout=subprocess.PIPE)
                try:
                    run(['gzip', '-1'], stdin=save.stdout, stdout=output)
                finally:
                    save.stdout.close()
                if save.wait() != 0:
                    raise RuntimeError('docker save failed')
            # Host deployment tooling is installed explicitly from reviewed
            # source, separate from arbitrary runtime image contents.
            run(['/usr/local/sbin/openagents-preview-deploy', sha])
            failure_file.unlink(missing_ok=True)
        except Exception:
            failure_file.write_text(json.dumps({'revision': sha, 'time': time.time()}) + '\n')
            raise
        finally:
            shutil.rmtree(build, ignore_errors=True)


if __name__ == '__main__':
    main()

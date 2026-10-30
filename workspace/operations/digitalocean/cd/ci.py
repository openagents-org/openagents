#!/usr/bin/env python3
"""Actions client. SSH keys never enter the checkout, image or build job."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


def main():
    sha = os.environ['RELEASE_SHA']
    if not re.fullmatch('[0-9a-f]{40}', sha): raise ValueError('Invalid release')
    hosts = [os.environ['DO_PRIMARY_HOST'], os.environ['DO_SECONDARY_HOST']]
    if any(not re.fullmatch('[0-9.]+', host) for host in hosts):
        raise ValueError('Invalid deployment host')
    current = subprocess.check_output(['gh', 'api',
        'repos/' + os.environ['GITHUB_REPOSITORY'] + '/git/ref/heads/release',
        '--jq', '.object.sha'], text=True).strip()
    if current != sha:
        print('Skipping superseded release'); return
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='backend-deploy-') as directory:
        key, known = Path(directory) / 'key', Path(directory) / 'known_hosts'
        key.write_text(os.environ.pop('DO_DEPLOY_SSH_KEY').strip() + '\n')
        known.write_text(os.environ.pop('DO_DEPLOY_KNOWN_HOSTS').strip() + '\n')
        options = ['ssh', '-i', str(key), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
                   '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(known),
                   '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15',
                   '-o', 'ServerAliveCountMax=4']
        def rpc(host, command, source=None, timeout=900):
            output = subprocess.check_output(options + ['root@' + host, command],
                                              stdin=source, timeout=timeout)
            return json.loads(output)
        for host in hosts:
            with open('backend-image.tar.gz', 'rb') as archive:
                rpc(host, 'stage ' + sha, archive)
            print('Image staged on a backend', flush=True)
        rpc(hosts[0], 'deploy ' + sha)
        for _ in range(160):
            time.sleep(15)
            try:
                result = rpc(hosts[0], 'result ' + sha, timeout=45)
            except (subprocess.SubprocessError, json.JSONDecodeError):
                continue  # server rollout survives a transient SSH interruption
            if result['status'] == 'running': continue
            print('Deployment result: ' + result['status'], flush=True)
            if result['status'] != 'deployed':
                raise RuntimeError('Deployment did not succeed; inspect private server logs')
            return
        raise RuntimeError('Timed out waiting; check server state before retrying')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Consistent pre-migration PostgreSQL snapshot, privately verified in Spaces."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import urllib.error
import boto3
from botocore.config import Config

ROOT = Path('/opt/openagents/cd')


def backup():
    cfg = json.loads((ROOT / 'secrets/backup.json').read_text())
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    directory = ROOT / 'backups'; directory.mkdir(mode=0o700, exist_ok=True)
    path = directory / ('pre-migration-' + stamp + '.dump')
    env = {**os.environ, **cfg['pg_env']}
    # libpq credentials are inherited privately, never command-line arguments.
    subprocess.run(['pg_dump', '--format=custom', '--no-owner', '--no-acl',
                    '--file', str(path)], env=env, check=True, timeout=1200)
    subprocess.run(['pg_restore', '--list', str(path)], stdout=subprocess.DEVNULL, check=True)
    with path.open('rb') as f: digest = hashlib.file_digest(f, 'sha256').hexdigest()
    s3 = boto3.client('s3', endpoint_url=cfg['endpoint'], region_name=cfg['region'],
        aws_access_key_id=cfg['key_id'], aws_secret_access_key=cfg['secret'],
        config=Config(signature_version='s3v4'))
    key = 'database-backups/automatic-deploy/' + path.name
    s3.upload_file(str(path), cfg['bucket'], key,
                  ExtraArgs={'ACL': 'private', 'Metadata': {'sha256': digest}})
    head = s3.head_object(Bucket=cfg['bucket'], Key=key)
    if head['ContentLength'] != path.stat().st_size or head['Metadata'].get('sha256') != digest:
        raise RuntimeError('Backup object metadata mismatch')
    body = s3.get_object(Bucket=cfg['bucket'], Key=key)['Body']
    verify = hashlib.sha256()
    with body:
        while chunk := body.read(8 * 1024 * 1024): verify.update(chunk)
    if verify.hexdigest() != digest: raise RuntimeError('Backup checksum mismatch')
    try:
        with urllib.request.urlopen(urllib.request.Request(
            cfg['public_bucket_url'] + '/' + key, method='HEAD'), timeout=15):
            raise RuntimeError('Backup is publicly accessible')
    except urllib.error.HTTPError as exc:
        if exc.code not in (403, 404): raise
    receipt = {'key': key, 'bytes': path.stat().st_size, 'sha256': digest,
               'download_verified': True, 'anonymous_access_denied': True}
    path.with_suffix('.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == '__main__':
    os.umask(0o077)
    backup()

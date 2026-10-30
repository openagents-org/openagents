#!/usr/bin/env python3
"""Upload a verified snapshot privately; credentials arrive through stdin only."""
import datetime
import hashlib
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.client import Config
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parent
BUCKET = 'openagents-ops'
PREFIX = sys.argv[2].rstrip('/') + '/' if len(sys.argv) > 2 else 'database-backups/2026-10-14/'
ARCHIVE = Path(sys.argv[1]).resolve()


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    credentials = json.load(sys.stdin)
    client = boto3.client('s3', endpoint_url='https://sfo3.digitaloceanspaces.com',
        region_name='sfo3', aws_access_key_id=credentials['key_id'],
        aws_secret_access_key=credentials['secret'],
        config=Config(signature_version='s3v4', retries={'max_attempts': 5, 'mode': 'standard'}))
    manifest = json.loads(ARCHIVE.with_suffix('.json').read_text())
    assert digest(ARCHIVE) == manifest['sha256'], 'Source archive checksum mismatch'
    results = []
    for path in (ARCHIVE, ARCHIVE.with_suffix('.json')):
        key = PREFIX + path.name
        expected = digest(path)
        size = path.stat().st_size
        try:
            existing = client.head_object(Bucket=BUCKET, Key=key)
        except ClientError as error:
            if error.response['Error']['Code'] not in ('404', 'NoSuchKey', 'NotFound'):
                raise
            existing = None
        if existing:
            assert existing['ContentLength'] == size and existing.get('Metadata', {}).get('sha256') == expected, 'Refusing to overwrite a different existing backup'
            client.put_object_acl(Bucket=BUCKET, Key=key, ACL='private')
        else:
            print('Uploading', path.name, size, 'bytes', flush=True)
            client.upload_file(str(path), BUCKET, key,
                ExtraArgs={'ACL': 'private', 'Metadata': {'sha256': expected},
                    'ContentType': 'application/json' if path.suffix == '.json' else 'application/octet-stream'},
                Config=TransferConfig(multipart_threshold=32*1024*1024,
                    multipart_chunksize=32*1024*1024, max_concurrency=4))
        head = client.head_object(Bucket=BUCKET, Key=key)
        assert head['ContentLength'] == size and head.get('Metadata', {}).get('sha256') == expected
        print('Verifying uploaded bytes:', path.name, flush=True)
        response = client.get_object(Bucket=BUCKET, Key=key)
        checksum = hashlib.sha256()
        with response['Body'] as body:
            while chunk := body.read(8*1024*1024):
                checksum.update(chunk)
        assert checksum.hexdigest() == expected, 'Uploaded object checksum mismatch'
        url = f'https://{BUCKET}.sfo3.digitaloceanspaces.com/{key}'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=30) as public:
                raise AssertionError('Backup is publicly accessible')
        except urllib.error.HTTPError as error:
            assert error.code in (403, 404), f'Unexpected anonymous status: {error.code}'
        results.append({'bucket': BUCKET, 'key': key, 'bytes': size,
            'sha256': expected, 'download_checksum_verified': True, 'anonymous_access_denied': True})
        print('Verified private backup:', key, flush=True)
    receipt = {'uploaded_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'objects': results}
    output = ARCHIVE.with_name(ARCHIVE.name + '.spaces-receipt.json')
    output.write_text(json.dumps(receipt, indent=2))
    output.chmod(0o600)
    print(json.dumps(receipt, indent=2), flush=True)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Copy database-referenced object bytes, retaining a private restore manifest.

No bucket-list permission is needed. Re-run after writers stop to collect new
keys, then archive this directory and upload with the database backup.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import sys
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
sys.path.insert(0, '/opt/openagents')
import migration as m

os.umask(0o077)
root = m.BACKUP / 'v11-file-objects'
root.mkdir(exist_ok=True)
(root / 'objects').mkdir(exist_ok=True)
env = dict(line.split('=', 1) for line in (m.SECRET / 'production.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
s3 = boto3.client('s3', region_name=env.get('S3_REGION', 'us-east-1'),
    aws_access_key_id=env['AWS_ACCESS_KEY_ID'], aws_secret_access_key=env['AWS_SECRET_ACCESS_KEY'],
    config=Config(max_pool_connections=12, retries={'max_attempts': 5, 'mode': 'standard'}))
keys = set()
with m.connect(m.target('openagents_workspace')) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='storage_key'")
        for (table,) in cur.fetchall():
            from psycopg2 import sql
            cur.execute(sql.SQL('SELECT DISTINCT storage_key FROM {} WHERE storage_key IS NOT NULL').format(sql.Identifier(table)))
            keys.update(row[0] for row in cur.fetchall() if row[0])
old_path = root / 'manifest.json'
old = {r['key']: r for r in json.loads(old_path.read_text()).get('objects', [])} if old_path.exists() else {}

def copy(key):
    name = hashlib.sha256(key.encode()).hexdigest()
    path = root / 'objects' / name
    args = {}
    if key in old and path.exists() and old[key].get('etag'):
        args['IfNoneMatch'] = old[key]['etag']
    try:
        response = s3.get_object(Bucket=env['S3_BUCKET'], Key=key, **args)
    except ClientError as error:
        if error.response['Error']['Code'] == '304' and key in old:
            return old[key]
        return {'key': key, 'error': error.response['Error']['Code']}
    digest = hashlib.sha256()
    with path.with_suffix('.partial').open('wb') as out, response['Body'] as body:
        while chunk := body.read(8*1024*1024):
            out.write(chunk); digest.update(chunk)
    path.with_suffix('.partial').replace(path)
    return {'key': key, 'path': 'objects/' + name, 'bytes': path.stat().st_size, 'sha256': digest.hexdigest(), 'etag': response.get('ETag')}

rows = []
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    for row in pool.map(copy, sorted(keys)):
        rows.append(row)
        if len(rows) % 1000 == 0:
            print('Copied/checked', len(rows), 'of', len(keys), flush=True)
            m.save(old_path, json.dumps({'source_bucket': env['S3_BUCKET'], 'objects': rows}))
m.save(old_path, json.dumps({'source_bucket': env['S3_BUCKET'], 'objects': rows}, indent=2))
print(json.dumps({'referenced_objects':len(rows), 'copied_objects':sum('sha256' in r for r in rows), 'bytes':sum(r.get('bytes',0) for r in rows), 'errors':sum('error' in r for r in rows)}), flush=True)

#!/usr/bin/env python3
"""Run on the migration host; audit only the isolated rehearsal database."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote
sys.path.insert(0, '/opt/openagents')
import migration as m

DB = 'openagents_rehearsal'
OUT = Path('/opt/openagents/backups/v11-rehearsal-before.json')

def audit():
    with m.connect(m.target(DB)) as conn:
        with conn.cursor() as cur:
            result = {}
            for table, columns, order in (
                ('workspaces', 'id::text, password_hash', 'id'),
                ('nodes', 'id::text, workspace_id::text, token, node_key', 'id'),
                ('workspace_members', 'workspace_id::text, agent_name, node_id::text, session_id', 'workspace_id, agent_name'),
            ):
                cur.execute(f'SELECT {columns} FROM {table} ORDER BY {order}')
                rows = cur.fetchall()
                result[table] = {'count': len(rows), 'identity_sha256': hashlib.sha256(json.dumps(rows).encode()).hexdigest()}
            return result

if sys.argv[1] == 'before':
    result = audit()
    m.save(OUT, json.dumps(result, indent=2))
    d = m.target(DB)
    url = f"postgresql://{quote(d['user'], safe='')}:{quote(d['password'], safe='')}@{d['host']}:{d['port']}/{DB}?sslmode=require"
    m.save(m.SECRET / 'v11-rehearsal-migration.env', f'DATABASE_URL={url}\n')
    print(json.dumps(result))
elif sys.argv[1] == 'after':
    result = audit()
    assert result == json.loads(OUT.read_text()), 'Workspace/device/agent identities or credentials changed'
    with m.connect(m.target(DB)) as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT version_num FROM alembic_version')
            assert cur.fetchone()[0] == '081'
            cur.execute('SELECT count(*) FROM nodes WHERE owner_email IS NULL')
            result['unowned_connections'] = cur.fetchone()[0]
            cur.execute('SELECT count(*) FROM workspaces WHERE legacy_machine_access')
            result['legacy_workspaces'] = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM nodes n JOIN workspaces w ON w.id=n.workspace_id WHERE n.owner_email IS NULL AND NOT w.legacy_machine_access")
            assert cur.fetchone()[0] == 0, 'Unowned connections outside compatibility scope'
            cur.execute("SELECT count(*) FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE nullif(trim(m.owner_email),'') IS NULL AND NOT w.legacy_machine_access")
            assert cur.fetchone()[0] == 0, 'Known-owner agents missed inheritance'
            cur.execute('SELECT count(*) FROM nodes WHERE NOT legacy_workspace_token')
            assert cur.fetchone()[0] == 0, 'Pre-v1.1 connection lost shared-token compatibility'
    result.update(revision='081', credentials_and_sessions_unchanged=True)
    m.save(OUT.with_name('v11-rehearsal-result.json'), json.dumps(result, indent=2))
    print(json.dumps(result))

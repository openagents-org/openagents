"""CVE-2026-108739: identity-scoped listing and secret-free serialization."""
from sqlalchemy import select
from app.models import Workspace
from tests.test_visibility import _bearer, no_push, people  # noqa: F401

SECRET = "SYNTHETIC_BROWSERFABRIC_KEY_NOT_A_REAL_SECRET"


def _configure(db, workspace):
    ws = db.execute(select(Workspace).where(Workspace.id == workspace['id'])).scalar_one()
    ws.settings = {'browserfabric_api_key': SECRET, 'theme': 'dark', 'monitorMode': True,
                   'future_service_token': SECRET, 'private_metadata': {'nested_key': SECRET}}
    db.commit()
    return ws


def test_list_requires_identity_even_with_workspace_token(client, workspace):
    for headers in ({}, {'X-Workspace-Token': workspace['token']}, {'Authorization': 'Bearer invalid'}):
        r = client.get('/v1/workspaces', headers=headers)
        assert r.status_code == 401


def test_list_scoped_to_membership_and_filters_cannot_expand_access(client, workspace, people, db):
    _configure(db, workspace)
    # All three people are members of the fixture workspace, but none owns this one.
    other = client.post('/v1/workspaces', json={'name': 'Other', 'creator_email': 'outsider@example.test'}).json()['data']
    for name in ('adam', 'mia', 'vic'):
        r = client.get('/v1/workspaces', headers=_bearer(name, workspace))
        assert r.status_code == 200
        assert {w['workspaceId'] for w in r.json()['data']} == {workspace['id']}
        assert SECRET not in r.text
        assert client.get('/v1/workspaces', params={'creator_email': 'outsider@example.test'}, headers=_bearer(name)).json()['data'] == []
        assert client.get('/v1/workspaces', params={'agent_name': 'agent-alpha'}, headers=_bearer(name)).json()['data']
    assert other['workspaceId'] != workspace['id']


def test_legacy_creator_and_collaborator_still_have_access(client, workspace, people, db):
    from app.models import WorkspaceCollaborator
    created = client.post('/v1/workspaces', json={'name': 'Legacy', 'creator_email': 'mia@acme.test'}).json()['data']
    db.add(WorkspaceCollaborator(workspace_id=created['workspaceId'], email='vic@acme.test', role='viewer'))
    db.commit()
    for name in ('mia', 'vic'):
        rows = client.get('/v1/workspaces', headers=_bearer(name)).json()['data']
        assert created['workspaceId'] in {w['workspaceId'] for w in rows}


def test_get_and_patch_never_return_raw_secret_and_preserve_stored_keys(client, workspace, db):
    ws = _configure(db, workspace)
    headers = {'X-Workspace-Token': workspace['token']}
    got = client.get(f"/v1/workspaces/{workspace['id']}", headers=headers)
    assert got.status_code == 200
    assert SECRET not in got.text
    assert got.json()['data']['settings'] == {'theme': 'dark', 'monitorMode': True}
    changed = client.patch(f"/v1/workspaces/{workspace['id']}", headers=headers, json={'settings': {'theme': 'light', 'monitorMode': False}})
    assert changed.status_code == 200
    assert SECRET not in changed.text
    db.expire_all()
    assert db.get(Workspace, ws.id).settings['browserfabric_api_key'] == SECRET
    assert db.get(Workspace, ws.id).settings['future_service_token'] == SECRET
    assert changed.json()['data']['settings']['theme'] == 'light'


def test_generic_settings_reject_secret_writes(client, workspace, db):
    ws = _configure(db, workspace)
    r = client.patch(f"/v1/workspaces/{workspace['id']}", headers={'X-Workspace-Token': workspace['token']}, json={'settings': {'browserfabric_api_key': 'replacement'}})
    assert r.status_code == 400
    db.expire_all()
    assert db.get(Workspace, ws.id).settings['browserfabric_api_key'] == SECRET

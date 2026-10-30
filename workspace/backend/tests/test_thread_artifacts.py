"""Pinned artifacts keep their original access controls and belong to the thread owner."""
import pytest
from sqlalchemy import select
from app.models import BrowserTab, Channel, FileRecord, KnowledgeEntry, Workspace
from tests.test_visibility import _bearer, _create_thread, people, no_push  # noqa: F401
from tests.test_thread_agent_settings import setup_thread


def artifact(db, workspace, kind, visibility='public'):
    common = dict(workspace_id=workspace['id'])
    if kind == 'file':
        row = FileRecord(**common, filename='dashboard.html', content_type='text/html', size=20,
                         storage_key='artifacts/dashboard', uploaded_by='human:mia@acme.test',
                         owner='human:mia@acme.test', visibility=visibility)
    elif kind == 'knowledge':
        row = KnowledgeEntry(**common, slug='report', title='Report', created_by='human:mia@acme.test',
                             owner='human:mia@acme.test', visibility=visibility)
    else:
        row = BrowserTab(**common, url='https://example.com', created_by='human:mia@acme.test')
    db.add(row); db.commit()
    return row


def pin(client, workspace, ref, user='mia'):
    return client.patch('/v1/channels/settings-test/artifact', headers=_bearer(user, workspace),
                        json={'network': workspace['id'], 'artifact': ref})


def read(client, workspace, user='mia'):
    return client.get(f"/v1/channels/settings-test/artifact?network={workspace['id']}", headers=_bearer(user, workspace))


@pytest.mark.parametrize('kind', ['file', 'knowledge', 'browser'])
def test_owner_pin_restore_and_clear(client, workspace, people, db, kind):
    setup_thread(client, workspace, db)
    row = artifact(db, workspace, kind)
    ref = {'kind': kind, 'id': row.id}
    assert pin(client, workspace, ref).status_code == 200
    assert read(client, workspace).json()['data'] == {'artifact': ref, 'unavailable': False, 'can_pin': True}
    assert read(client, workspace, 'vic').json()['data'] == {'artifact': ref, 'unavailable': False, 'can_pin': False}
    for user in ('vic', 'adam'):
        assert pin(client, workspace, None, user).status_code == 403
    assert client.patch('/v1/channels/settings-test/artifact', headers={'X-Workspace-Token':workspace['token']},
                        json={'network':workspace['id'],'artifact':None}).status_code == 403
    assert pin(client, workspace, None).status_code == 200
    assert read(client, workspace).json()['data']['artifact'] is None


@pytest.mark.parametrize('kind', ['file', 'knowledge'])
def test_private_pin_does_not_grant_or_disclose_reference(client, workspace, people, db, kind):
    setup_thread(client, workspace, db)
    row = artifact(db, workspace, kind, 'private')
    ref = {'kind': kind, 'id':row.id}
    assert pin(client, workspace, ref).status_code == 200
    assert read(client, workspace, 'vic').json()['data'] == {'artifact':None,'unavailable':True,'can_pin':False}
    assert read(client, workspace).json()['data']['artifact'] == ref
    row.status = 'deleted'; db.commit()
    assert read(client, workspace).json()['data']['unavailable'] is True
    assert pin(client, workspace, ref).status_code == 404
    assert pin(client, workspace, None).status_code == 200


def test_cross_workspace_and_inaccessible_thread(client, workspace, people, db):
    setup_thread(client, workspace, db)
    other = Workspace(name='Other',slug='artifact-other',password_hash='secret')
    db.add(other); db.commit()
    row = artifact(db, {'id':other.id}, 'browser')
    assert pin(client, workspace, {'kind':'browser','id':row.id}).status_code == 404
    _create_thread(client, workspace, name='private-artifacts', by='mia', visibility='private')
    assert client.get(f"/v1/channels/private-artifacts/artifact?network={workspace['id']}", headers=_bearer('vic', workspace)).status_code == 404
    assert pin(client, workspace, {'kind':'invalid','id':'x'}).status_code == 422

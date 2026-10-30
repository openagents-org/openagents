"""Opaque thread routes retain channel and DM read permissions."""
from uuid import UUID
from sqlalchemy import select
from app.models import Channel, Workspace
from tests.test_visibility import _bearer, _create_thread, people, no_push  # noqa: F401


def link(client, ws, session, user='mia'):
    return client.post('/v1/thread-links', headers=_bearer(user, ws), json={'network':ws['id'],'session_id':session})


def resolve(client, ws, thread_id, user='mia'):
    return client.get(f"/v1/thread-links/{thread_id}?network={ws['id']}",headers=_bearer(user,ws))


def test_channel_url_uses_database_id_and_survives_name_changes(client, workspace, people, db):
    _create_thread(client,workspace,name='named-thread',by='mia',visibility='public')
    row=db.execute(select(Channel).where(Channel.name=='named-thread')).scalar_one()
    result=link(client,workspace,'named-thread').json()['data']
    assert result=={'id':str(row.id),'session_id':'named-thread'}
    assert resolve(client,workspace,result['id'],'vic').json()['data']['session_id']=='named-thread'
    row.name='renamed-thread';db.commit()
    assert resolve(client,workspace,result['id']).json()['data']['session_id']=='renamed-thread'
    row.status='deleted';db.commit()
    assert resolve(client,workspace,result['id']).status_code==404


def test_direct_route_is_opaque_stable_and_participant_only(client, workspace, people, db):
    key='dm:human:mia@acme.test,human:vic@acme.test'
    first=link(client,workspace,key).json()['data']
    assert str(UUID(first['id']))==first['id']
    assert 'mia' not in first['id'] and '@' not in first['id']
    assert link(client,workspace,'dm:human:vic@acme.test,human:mia@acme.test','vic').json()['data']==first
    assert resolve(client,workspace,first['id'],'vic').json()['data']['session_id']==key
    # Even a workspace admin cannot open another person's direct conversation.
    assert resolve(client,workspace,first['id'],'adam').status_code==404
    assert link(client,workspace,key,'adam').status_code==404
    assert link(client,workspace,'dm:human:mia@acme.test,human:mia@acme.test').status_code==200
    assert link(client,workspace,'dm:human:mia@acme.test').status_code==404
    assert resolve(client,workspace,'not-a-uuid').status_code==404


def test_private_and_foreign_workspace_routes_are_not_resolved(client, workspace, people, db):
    _create_thread(client,workspace,name='secret-thread',by='mia',visibility='private')
    route=link(client,workspace,'secret-thread').json()['data']['id']
    assert link(client,workspace,'secret-thread','vic').status_code==404
    assert resolve(client,workspace,route,'vic').status_code==404
    other=Workspace(name='Other',slug='other-thread-links',password_hash='other-secret')
    db.add(other);db.commit()
    assert client.get(f'/v1/thread-links/{route}?network={other.id}',headers={'X-Workspace-Token':'other-secret'}).status_code==404


def test_artifact_upload_can_explicitly_inherit_private_thread_access(client, workspace, people, db):
    from app.models import FileRecord
    _create_thread(client,workspace,name='secret-outputs',by='mia',visibility='private')
    response=client.post('/v1/files/base64',headers={'X-Workspace-Token':workspace['token']},json={
        'network':workspace['id'],'filename':'report.html','content_base64':'PGgxPlJlcG9ydDwvaDE+',
        'content_type':'text/html','source':'openagents:agent-alpha','channel_name':'secret-outputs','visibility':'inherit'})
    assert response.status_code==200,response.text
    file_id=response.json()['data']['id']
    assert db.get(FileRecord,file_id).visibility is None
    assert client.get(f'/v1/files/{file_id}',headers=_bearer('vic',workspace)).status_code==403

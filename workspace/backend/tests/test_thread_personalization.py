"""Personal navigation never grants access or changes other people's preferences."""
from sqlalchemy import select
from app.models import Channel, DirectThreadPreference, EventRecord
from tests.test_visibility import _bearer, _create_thread, people, no_push  # noqa: F401
from tests.test_thread_links import link


def test_thread_icon_owner_only_and_reset(client, workspace, people, db):
    _create_thread(client,workspace,name='icon-thread',by='mia',visibility='public')
    def change(user, icon):
        return client.patch('/v1/channels/icon-thread', headers=_bearer(user,workspace), json={'network':workspace['id'],'icon':icon})
    assert change('vic','🚀').status_code == 403
    assert change('adam','🚀').status_code == 403
    assert change('mia','🚀').status_code == 200
    channel=db.execute(select(Channel).where(Channel.name=='icon-thread')).scalar_one()
    db.refresh(channel)
    assert channel.icon == '🚀'
    assert change('mia','x'*33).status_code == 422
    assert change('mia',None).status_code == 200
    db.refresh(channel)
    assert channel.icon is None


def test_dm_preferences_are_personal_and_preserve_privacy(client, workspace, people, db):
    pair='dm:human:mia@acme.test,human:vic@acme.test'
    thread_id=link(client,workspace,pair).json()['data']['id']
    def change(user, **data):
        return client.patch(f'/v1/thread-links/{thread_id}/preferences', headers=_bearer(user,workspace),json={'network':workspace['id'],**data})
    assert change('adam',pinned=True).status_code == 404
    assert client.patch(f'/v1/thread-links/{thread_id}/preferences',headers={'X-Workspace-Token':workspace['token']},json={'network':workspace['id'],'starred':True}).status_code == 403
    assert change('mia',pinned=True,starred=True).json()['data']=={'pinned':True,'starred':True}
    assert change('vic',pinned=False).json()['data']=={'pinned':False,'starred':False}
    assert change('mia',pinned=False).json()['data']=={'pinned':False,'starred':True}
    db.add(EventRecord(id='preference-message',network_id=workspace['id'],source='human:mia@acme.test',target='human:vic@acme.test',type='workspace.message.posted',visibility='direct',timestamp=12345,payload={'content':'hi'}))
    db.commit()
    def conversations(user):
        return client.get('/v1/events/conversations',params={'network':workspace['id']},headers=_bearer(user,workspace)).json()['data']['conversations']
    assert conversations('mia')[0]['starred'] is True
    assert conversations('vic')[0]['starred'] is False
    assert conversations('adam') == []

from sqlalchemy import select
from app.models import EventRecord, MessageReaction
from tests.test_visibility import people, no_push, _bearer, _create_thread


def test_reactions_are_personal_idempotent_and_do_not_dispatch(client,workspace,people,db):
    _create_thread(client,workspace,name='react',by='mia',visibility='public')
    db.add(EventRecord(id='human-msg',network_id=workspace['id'],type='workspace.message.posted',source='human:mia@acme.test',target='channel/react',payload={'content':'Hello'},timestamp=1))
    db.commit()
    url=f"/v1/reactions/human-msg?network={workspace['id']}"
    for _ in range(2):
        response=client.put(url,headers=_bearer('mia'),json={'emoji':'👍','active':True})
        assert response.status_code==200,response.text
        assert response.json()['data']==[{'emoji':'👍','count':1,'mine':True}]
    response=client.put(url,headers=_bearer('adam'),json={'emoji':'👍','active':True})
    assert response.json()['data']==[{'emoji':'👍','count':2,'mine':True}]
    response=client.put(url,headers=_bearer('mia'),json={'emoji':'👍','active':False})
    assert response.json()['data']==[{'emoji':'👍','count':1,'mine':False}]
    assert len(db.execute(select(MessageReaction)).scalars().all())==1
    assert len(db.execute(select(EventRecord).where(EventRecord.type=='workspace.message.posted')).scalars().all())==1
    assert client.put(url,headers=_bearer('adam'),json={'emoji':'bad','active':True}).status_code==422


def test_reactions_respect_private_threads_and_dms(client,workspace,people,db):
    _create_thread(client,workspace,name='secret-react',by='mia')
    for mid,source,target in [('private','human:mia@acme.test','channel/secret-react'),('dm','human:mia@acme.test','human:vic@acme.test'),('agent','openagents:agent-alpha','channel/secret-react')]:
        db.add(EventRecord(id=mid,network_id=workspace['id'],type='workspace.message.posted',source=source,target=target,payload={'content':'secret'},timestamp=1))
    db.commit()
    for mid in ['private','dm','agent']:
        assert client.put(f"/v1/reactions/{mid}?network={workspace['id']}",headers=_bearer('adam'),json={'emoji':'❤️','active':True}).status_code==404
    result=client.post(f"/v1/reactions/query?network={workspace['id']}",headers=_bearer('adam'),json={'ids':['private','dm','agent']})
    assert result.json()['data']=={}
    assert client.put(f"/v1/reactions/dm?network={workspace['id']}",headers=_bearer('mia'),json={'emoji':'❤️','active':True}).status_code==200

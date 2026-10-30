"""Channel designation is a shared label, never a privacy/routing conversion."""
from sqlalchemy import select
from app.models import Channel, ChannelHumanMember
from tests.test_visibility import people, no_push, _create_thread, _bearer, _post


def label(client, ws, name, user, value):
    return client.patch(f"/v1/workspaces/{ws['id']}/channels/{name}",
                        headers=_bearer(user, ws), json={"is_channel": value})


def discover(client, ws, user):
    response = client.get(f"/v1/discover?network={ws['id']}", headers=_bearer(user, ws))
    assert response.status_code == 200, response.text
    return {c['address']: c for c in response.json()['data']['channels']}


def test_channel_label_is_shared_reversible_and_preserves_thread(client, workspace, people, db):
    _create_thread(client, workspace, name="ongoing", by="mia", visibility="public")
    assert _post(client, workspace, channel="ongoing", by="mia", content="Keep this history").status_code == 200
    channel = db.execute(select(Channel).where(Channel.name == "ongoing")).scalar_one()
    fields = ('id', 'visibility', 'owner_email', 'director_email', 'response_mode',
              'orchestration_mode', 'workflow_id', 'status', 'last_event_at', 'starred')
    original = {field: getattr(channel, field) for field in fields}
    members = list(db.execute(select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == channel.id)).scalars())
    assert discover(client, workspace, "mia")["channel/ongoing"]["is_channel"] is False
    for enabled in (True, True, False):
        response = label(client, workspace, "ongoing", "mia", enabled)
        assert response.status_code == 200, response.text
        assert response.json()['data']['isChannel'] is enabled
        for viewer in ('mia', 'adam'):
            assert discover(client, workspace, viewer)["channel/ongoing"]['is_channel'] is enabled
        db.refresh(channel)
        assert {field: getattr(channel, field) for field in fields} == original
        assert list(db.execute(select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == channel.id)).scalars()) == members


def test_channel_label_keeps_private_access_and_requires_settings_permission(client, workspace, people, db):
    _create_thread(client, workspace, name="private-channel", by="mia")
    assert label(client, workspace, "private-channel", "mia", True).status_code == 200
    assert "channel/private-channel" not in discover(client, workspace, "vic")
    assert label(client, workspace, "private-channel", "vic", False).status_code == 403
    assert label(client, workspace, "private-channel", "adam", False).status_code == 403
    channel = db.execute(select(Channel).where(Channel.name == 'private-channel')).scalar_one()
    db.add(ChannelHumanMember(channel_id=channel.id, user_email='adam@acme.test'))
    db.add(ChannelHumanMember(channel_id=channel.id, user_email='vic@acme.test'))
    db.commit()
    assert label(client, workspace, "private-channel", "vic", False).status_code == 403
    assert label(client, workspace, "private-channel", "adam", False).status_code == 200

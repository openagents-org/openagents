from sqlalchemy import select
from app.models import Channel, ThreadPin
from tests.test_visibility import people, no_push, _create_thread, _bearer, _tok


def pin(client, ws, name, user, value=True):
    return client.patch(f"/v1/workspaces/{ws['id']}/channels/{name}", headers=_bearer(user, ws), json={"pinned": value})


def discover(client, ws, user):
    return client.get(f"/v1/discover?network={ws['id']}", headers=_bearer(user, ws)).json()["data"]["channels"]


def test_pins_are_persistent_personal_and_independent_of_stars(client, workspace, people, db):
    _create_thread(client, workspace, name="pin-me", by="mia", visibility="public")
    for _ in range(2):
        response = pin(client, workspace, "pin-me", "mia")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["pinned"] is True
    assert next(c for c in discover(client, workspace, "mia") if c["address"] == "channel/pin-me")["pinned"] is True
    assert next(c for c in discover(client, workspace, "adam") if c["address"] == "channel/pin-me")["pinned"] is False
    channel = db.execute(select(Channel).where(Channel.name == "pin-me")).scalar_one()
    assert not channel.starred
    assert len(list(db.execute(select(ThreadPin)).scalars())) == 1
    assert pin(client, workspace, "pin-me", "mia", False).status_code == 200
    assert not next(c for c in discover(client, workspace, "mia") if c["address"] == "channel/pin-me")["pinned"]
    assert not list(db.execute(select(ThreadPin)).scalars())


def test_pins_require_identity_and_thread_access(client, workspace, people):
    _create_thread(client, workspace, name="private-pin", by="mia")
    assert pin(client, workspace, "private-pin", "vic").status_code == 403
    assert client.patch(f"/v1/workspaces/{workspace['id']}/channels/private-pin", headers=_tok(workspace), json={"pinned": True}).status_code == 403
    assert pin(client, workspace, "private-pin", "mia").status_code == 200

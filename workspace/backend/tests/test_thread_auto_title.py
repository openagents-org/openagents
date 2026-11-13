# -*- coding: utf-8 -*-
"""A thread is titled from its first human message only while nobody has named
it: a title typed in the New Thread dialog stays, even "New Thread"."""

import pytest
from app.models import Channel


@pytest.fixture(autouse=True)
def no_side_effects(monkeypatch):
    import app.services.notify as notify_mod
    import app.services.push as push_mod
    monkeypatch.setattr(notify_mod, "_dispatch", lambda snapshot: None)
    monkeypatch.setattr(push_mod, "fanout_for_event", lambda *a, **k: None)
    import app.routers.events as events_mod
    import app.services.cloud_agent as cloud_mod
    import app.services.integrations as integ_mod
    import app.services.watches as watches_mod
    noop = lambda *a, **k: None  # noqa: E731
    for mod, name in ((events_mod, "invoke_cloud_agents"), (cloud_mod, "invoke_cloud_agents"),
                      (integ_mod, "relay_for_event"), (watches_mod, "notify_watchers")):
        if hasattr(mod, name):
            monkeypatch.setattr(mod, name, noop)


def _send(client, ws, event):
    r = client.post("/v1/events", json={"network": ws["id"], **event},
                    headers={"X-Workspace-Token": ws["token"]})
    assert r.status_code == 200, r.text


def _title_after_first_message(client, db, ws, name, **payload):
    _send(client, ws, {"type": "network.channel.create", "source": "human:user", "target": "core",
                       "payload": {"name": name, "visibility": "public", **payload}})
    _send(client, ws, {"type": "workspace.message.posted", "source": "human:user",
                       "target": f"channel/{name}",
                       "payload": {"content": "Plan the launch\nwith details", "message_type": "chat"}})
    db.expire_all()
    return db.query(Channel).filter_by(name=name).one()


@pytest.mark.parametrize("title", ["New Thread", "Session 1"])
def test_typed_default_looking_title_is_kept(client, db, workspace, title):
    channel = _title_after_first_message(client, db, workspace, f"typed-{title[0]}",
                                         title=title, title_manually_set=True)
    assert channel.title == title
    assert channel.title_manually_set is True


def test_untyped_default_title_still_follows_the_first_message(client, db, workspace):
    channel = _title_after_first_message(client, db, workspace, "untyped", title="New Thread")
    assert channel.title == "Plan the launch"
    assert not channel.title_manually_set


def test_flag_without_a_title_marks_nothing(client, db, workspace):
    channel = _title_after_first_message(client, db, workspace, "no-title", title_manually_set=True)
    assert channel.title == "Plan the launch"

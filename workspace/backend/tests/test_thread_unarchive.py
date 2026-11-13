# -*- coding: utf-8 -*-
"""A person posting in an archived thread brings it back to the active list."""

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


def _archived_thread(client, db, ws, name):
    _send(client, ws, {"type": "network.channel.create", "source": "human:user", "target": "core",
                       "payload": {"name": name, "visibility": "public"}})
    channel = db.query(Channel).filter_by(name=name).one()
    channel.status = "archived"
    db.commit()


def _status(db, name):
    db.expire_all()
    return db.query(Channel).filter_by(name=name).one().status


def test_a_person_posting_unarchives_the_thread(client, db, workspace):
    _archived_thread(client, db, workspace, "old-plan")
    _send(client, workspace, {"type": "workspace.message.posted", "source": "human:user",
                              "target": "channel/old-plan", "payload": {"content": "Picking this up again", "message_type": "chat"}})
    assert _status(db, "old-plan") == "active"


def test_agent_progress_leaves_it_archived(client, db, workspace):
    _archived_thread(client, db, workspace, "quiet")
    _send(client, workspace, {"type": "workspace.message.posted", "source": "openagents:agent-alpha",
                              "target": "channel/quiet", "payload": {"content": "working…", "message_type": "status"}})
    assert _status(db, "quiet") == "archived"

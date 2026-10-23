# -*- coding: utf-8 -*-
"""
The SSE stream and the per-channel previews honour the same visibility as
polling: a person never receives a private thread they are not in, nor a DM
they are not a side of. Machines keep the full feed.
"""

import json

import pytest

from tests.test_people_messaging import (  # noqa: F401  (fixtures)
    ADAM, MIA, VIC, _as, _dm, _say, _thread, _tok, people, pushes, quiet_side_effects,
)


@pytest.fixture
def published(monkeypatch):
    """Capture what POST /v1/events publishes to the Redis stream channel."""
    from app import cache
    out = []
    monkeypatch.setattr(cache, "publish_event", lambda ch, data: out.append(data))
    return out


@pytest.fixture
def scenario(client, workspace, people, pushes, published):
    """A private thread between mia and adam, and a DM mia → adam."""
    from app.models import Channel
    from app.services.visibility import add_channel_participant
    from sqlalchemy import select
    from tests.conftest import TestingSessionLocal

    _thread(client, workspace, name="secret", by="mia", visibility="private")
    db = TestingSessionLocal()
    ch = db.execute(select(Channel).where(Channel.name == "secret")).scalar_one()
    add_channel_participant(db, ch, ADAM)
    db.commit()
    db.close()
    _thread(client, workspace, name="open", by="mia")
    _say(client, workspace, channel="secret", by="mia", content="private thread msg")
    _say(client, workspace, channel="open", by="mia", content="open thread msg")
    _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="dm msg")
    return published


def _stream(client, workspace, monkeypatch, published, headers=None, params=""):
    import app.routers.events as events_mod
    from app import cache
    from tests.conftest import TestingSessionLocal

    async def fake_subscribe(_channel):
        for data in list(published):
            yield data

    monkeypatch.setattr(events_mod, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(cache, "subscribe_events", fake_subscribe)
    r = client.get(f"/v1/events/stream?network={workspace['id']}{params}", headers=headers or {})
    assert r.status_code == 200, r.text
    contents = []
    for line in r.text.splitlines():
        if line.startswith("data: "):
            ev = json.loads(line[len("data: "):])
            contents.append((ev.get("payload") or {}).get("content") or ev.get("type"))
    return contents


class TestStream:
    def test_third_member_gets_neither_private_thread_nor_dm(self, client, workspace, scenario, monkeypatch):
        got = _stream(client, workspace, monkeypatch, scenario, headers=_as("vic", workspace))
        assert "open thread msg" in got
        assert "private thread msg" not in got
        assert "dm msg" not in got

    def test_private_thread_creation_does_not_leak(self, client, workspace, scenario, monkeypatch):
        import app.routers.events as events_mod
        raw = []

        async def fake_subscribe(_channel):
            for data in list(scenario):
                yield data

        from app import cache
        from tests.conftest import TestingSessionLocal
        monkeypatch.setattr(events_mod, "SessionLocal", TestingSessionLocal)
        monkeypatch.setattr(cache, "subscribe_events", fake_subscribe)
        r = client.get(f"/v1/events/stream?network={workspace['id']}", headers=_as("vic", workspace))
        raw = [json.loads(l[6:]) for l in r.text.splitlines() if l.startswith("data: ")]
        names = [(e.get("payload") or {}).get("name") for e in raw if str(e.get("type", "")).startswith("network.channel.")]
        assert "secret" not in names

    def test_participants_get_both(self, client, workspace, scenario, monkeypatch):
        for who in ("adam", "mia"):
            got = _stream(client, workspace, monkeypatch, scenario, headers=_as(who, workspace))
            assert {"open thread msg", "private thread msg", "dm msg"} <= set(got), who

    def test_bearer_via_query_param(self, client, workspace, scenario, monkeypatch):
        got = _stream(client, workspace, monkeypatch, scenario,
                      params=f"&token={workspace['token']}&access_token=vic")
        assert "dm msg" not in got and "private thread msg" not in got
        got = _stream(client, workspace, monkeypatch, scenario,
                      params=f"&token={workspace['token']}&access_token=adam")
        assert "dm msg" in got and "private thread msg" in got

    def test_machine_keeps_full_feed(self, client, workspace, scenario, monkeypatch):
        got = _stream(client, workspace, monkeypatch, scenario, headers=_tok(workspace))
        assert {"open thread msg", "private thread msg", "dm msg"} <= set(got)

    def test_single_hidden_channel_is_forbidden(self, client, workspace, scenario, monkeypatch):
        import app.routers.events as events_mod
        from tests.conftest import TestingSessionLocal
        monkeypatch.setattr(events_mod, "SessionLocal", TestingSessionLocal)
        r = client.get(f"/v1/events/stream?network={workspace['id']}&channel=secret",
                       headers=_as("vic", workspace))
        assert r.status_code == 403


class TestEventVisibleTo:
    def test_rules(self):
        from app.routers.events import _event_visible_to as ok
        me = ADAM
        assert ok({"target": "channel/a", "source": "x"}, me, set())
        assert not ok({"target": "channel/a", "source": "x"}, me, {"a"})
        assert ok({"visibility": "direct", "source": f"human:{MIA}", "target": f"human:{ADAM}"}, me, set())
        assert not ok({"visibility": "direct", "source": f"human:{MIA}", "target": f"human:{VIC}"}, me, set())
        assert ok({"visibility": "direct", "source": "human:user", "target": "openagents:a"}, me, set())
        assert ok({"visibility": "direct", "source": "openagents:a", "target": "openagents:b"}, None, set())
        # no visibility field + non-channel target → treated as direct
        assert not ok({"source": f"human:{MIA}", "target": f"human:{VIC}"}, me, set())


class TestLatestPerChannel:
    def _previews(self, client, workspace, headers):
        r = client.get(f"/v1/events/latest-per-channel?network={workspace['id']}", headers=headers)
        assert r.status_code == 200, r.text
        return r.json()["data"]["channels"]

    def test_third_member_does_not_see_private_thread_preview(self, client, workspace, scenario):
        vic = self._previews(client, workspace, _as("vic", workspace))
        assert "open" in vic and "secret" not in vic
        assert not any("dm msg" == (c["payload"] or {}).get("content") for c in vic.values())
        for who in ("adam", "mia"):
            got = self._previews(client, workspace, _as(who, workspace))
            assert got["secret"]["payload"]["content"] == "private thread msg"
        assert "secret" in self._previews(client, workspace, _tok(workspace))

# -*- coding: utf-8 -*-
"""
Tests for the event-native API (POST/GET /v1/events).
"""

import pytest


class TestSendEvent:
    """POST /v1/events — send events through the pipeline."""

    def test_send_message_event(self, client, workspace):
        """Send a workspace.message.posted event through the pipeline."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": f"channel/{channel_name}",
            "payload": {"content": "Hello, world!"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["type"] == "workspace.message.posted"
        assert data["source"] == "human:user1"
        assert data["target"] == f"channel/{channel_name}"
        assert "id" in data
        assert "timestamp" in data

    def test_send_event_missing_network(self, client, workspace):
        """Events without network field are rejected."""
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": "channel/test",
        })
        assert resp.status_code == 400

    def test_send_event_invalid_network(self, client, workspace):
        """Events with nonexistent network are rejected."""
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": "channel/test",
            "network": "nonexistent",
        })
        assert resp.status_code == 404

    def test_send_event_wrong_token(self, client, workspace):
        """Events with wrong token are rejected by auth mod."""
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": "channel/test",
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": "wrong-token"})
        assert resp.status_code == 401

    def test_send_event_stamps_network_id(self, client, workspace):
        """Auth mod stamps network ID on the event."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {"content": "test"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200

        # Verify event was persisted
        poll = client.get("/v1/events", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert poll.status_code == 200
        events = poll.json()["data"]["events"]
        assert len(events) >= 1
        found = [e for e in events if e["type"] == "workspace.message.posted"]
        assert len(found) >= 1

    def test_send_event_with_metadata(self, client, workspace):
        """Custom metadata is preserved through the pipeline."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {"content": "test"},
            "metadata": {"custom_key": "custom_value"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["metadata"]["custom_key"] == "custom_value"

    def test_human_message_routes_to_master(self, client, workspace):
        """Human messages are routed to the channel master agent."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": f"channel/{channel_name}",
            "payload": {"content": "Hello agent!"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # workspace_mod should add target_agents with the channel master
        assert "target_agents" in data["metadata"]
        assert "agent-alpha" in data["metadata"]["target_agents"]


    def test_agent_message_master_no_targeting_in_single_agent_channel(self, client, workspace):
        """Master agent messages in single-agent channels have empty target_agents.

        With the LLM router, multi-agent routing uses the router.
        In single-agent channels (or when router is disabled), the fallback
        applies: master's own messages get no targeting.

        As of the routing fix: target_agents is ALWAYS set (to an empty
        list if nobody should respond) so clients don't fall through to
        broadcast-to-all on missing field.
        """
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {
                "content": "@agent-beta please review the code",
                "message_type": "chat",
            },
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # Master's message in a single-agent channel — no real targets
        # (sentinel list, not missing, so legacy clients don't broadcast)
        assert data["metadata"].get("target_agents") == ["__no_response__"]

    def test_master_message_without_mentions_no_target_agents(self, client, workspace):
        """Master agent messages without mentions produce empty target_agents (no self-trigger)."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",  # agent-alpha is the channel master
            "target": f"channel/{channel_name}",
            "payload": {"content": "Just a status update"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # Master's own messages should NOT trigger itself — sentinel
        # list (not missing field, not empty) so legacy clients skip.
        assert data["metadata"].get("target_agents") == ["__no_response__"]

    def test_member_message_without_mentions_routes_to_master(self, client, workspace):
        """Member agent messages without mentions route back to channel master."""
        # Add a member agent
        client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-beta",  # member, not master
            "target": f"channel/{channel_name}",
            "payload": {"content": "I finished the task."},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # Member's response should be routed back to the master
        assert data["metadata"]["target_agents"] == ["agent-alpha"]

    def test_member_message_with_mention_routes_to_mentioned_agent(self, client, workspace):
        """Agent messages with explicit @mentions route to the mentioned agent."""
        # Add member agents to workspace (not to channel — so channel stays single-participant)
        for name in ["agent-beta", "agent-gamma"]:
            client.post("/v1/join", json={
                "agent_name": name,
                "token": workspace["token"],
                "network": workspace["id"],
            })

        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-beta",
            "target": f"channel/{channel_name}",
            "payload": {"content": "@agent-gamma can you review this?"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # Explicit @mention routes directly to the mentioned agent
        assert data["metadata"]["target_agents"] == ["agent-gamma"]


class TestPollEvents:
    """GET /v1/events — poll events from a network."""

    def test_poll_empty_network(self, client, workspace):
        """Polling a new network returns empty list."""
        resp = client.get("/v1/events", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["events"] == []
        assert data["has_more"] is False

    def test_poll_after_send(self, client, workspace):
        """Events appear after being sent."""
        channel_name = workspace["channel"]["name"]
        # Send an event
        client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {"content": "msg1"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        # Poll
        resp = client.get("/v1/events", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        events = resp.json()["data"]["events"]
        assert len(events) == 1
        assert events[0]["payload"]["content"] == "msg1"

    def test_poll_filter_by_type(self, client, workspace):
        """Filter events by type prefix."""
        channel_name = workspace["channel"]["name"]
        # Send two different event types
        for etype in ("workspace.message.posted", "workspace.session.created"):
            client.post("/v1/events", json={
                "type": etype,
                "source": "openagents:agent-alpha",
                "target": f"channel/{channel_name}",
                "payload": {},
                "network": workspace["id"],
            }, headers={"X-Workspace-Token": workspace["token"]})

        # Filter by workspace.session
        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "workspace.session",
        }, headers={"X-Workspace-Token": workspace["token"]})
        events = resp.json()["data"]["events"]
        assert len(events) == 1
        assert events[0]["type"] == "workspace.session.created"

    def test_poll_filter_by_target(self, client, workspace):
        """Filter events by target address."""
        channel_name = workspace["channel"]["name"]
        client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        # Filter by exact target
        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "target": f"channel/{channel_name}",
        }, headers={"X-Workspace-Token": workspace["token"]})
        events = resp.json()["data"]["events"]
        assert len(events) == 1

        # Different target returns empty
        resp2 = client.get("/v1/events", params={
            "network": workspace["id"],
            "target": "channel/nonexistent",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp2.json()["data"]["events"] == []

    def test_poll_cursor_pagination(self, client, workspace):
        """Cursor-based pagination with after parameter."""
        channel_name = workspace["channel"]["name"]
        # Send 3 events
        event_ids = []
        for i in range(3):
            resp = client.post("/v1/events", json={
                "type": "workspace.message.posted",
                "source": "openagents:agent-alpha",
                "target": f"channel/{channel_name}",
                "payload": {"content": f"msg{i}"},
                "network": workspace["id"],
            }, headers={"X-Workspace-Token": workspace["token"]})
            event_ids.append(resp.json()["data"]["id"])

        # Get first page (limit 2)
        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "limit": 2,
        }, headers={"X-Workspace-Token": workspace["token"]})
        data = resp.json()["data"]
        assert len(data["events"]) == 2
        assert data["has_more"] is True

        # Get second page using cursor
        resp2 = client.get("/v1/events", params={
            "network": workspace["id"],
            "after": data["events"][1]["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})
        data2 = resp2.json()["data"]
        assert len(data2["events"]) == 1
        assert data2["has_more"] is False

    def test_poll_invalid_network(self, client):
        """Polling nonexistent network returns 404."""
        resp = client.get("/v1/events", params={"network": "nonexistent"})
        assert resp.status_code == 404


class TestPollTargetAgents:
    """GET /v1/events?target_agents= — server-side per-agent filtering.

    The adapter's `pollPending` sends this so agents stop pulling the whole
    network's traffic. The filter matches exactly what the adapter keeps:
    events targeting the agent + untargeted *human* messages. Events for other
    agents, the `__no_response__` sentinel, and untargeted *agent* messages
    (agent-to-agent chatter the adapter discards) are excluded.
    """

    def _seed(self, db, workspace):
        """Insert message events with assorted target_agents + sources."""
        from app.models import EventRecord

        net = workspace["id"]
        ch = f"channel/{workspace['channel']['name']}"
        rows = [
            # (id, target_agents, source)
            ("ev-a", ["alpha"], "human:user1"),           # for alpha
            ("ev-b", ["beta"], "human:user1"),            # for beta only
            ("ev-ab", ["alpha", "beta"], "human:user1"),  # for both
            ("ev-human-none", None, "human:user1"),       # untargeted human → broadcast
            ("ev-agent-none", None, "openagents:beta"),   # untargeted agent → discarded
            ("ev-noresp", ["__no_response__"], "human:user1"),  # routed-to-nobody
        ]
        for i, (eid, targets, source) in enumerate(rows):
            meta = {} if targets is None else {"target_agents": targets}
            db.add(EventRecord(
                id=eid,
                network_id=net,
                type="workspace.message.posted",
                source=source,
                target=ch,
                payload={"content": eid, "message_type": "chat"},
                metadata_=meta,
                timestamp=1_000 + i,
            ))
        db.commit()

    def test_filters_to_targeted_plus_untargeted_human(self, client, workspace, db):
        self._seed(db, workspace)

        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "workspace.message.posted",
            "target_agents": "alpha",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        ids = {e["id"] for e in resp.json()["data"]["events"]}

        # alpha's events + untargeted *human* broadcast
        assert "ev-a" in ids
        assert "ev-ab" in ids
        assert "ev-human-none" in ids
        # never beta-only, the sentinel, or untargeted *agent* chatter
        assert "ev-b" not in ids
        assert "ev-noresp" not in ids
        assert "ev-agent-none" not in ids

    def test_next_cursor_skips_ahead_to_stream_tip(self, client, workspace, db):
        """When an agent has drained its own events, next_cursor jumps to the
        stream tip so it doesn't re-scan other agents' traffic each poll."""
        self._seed(db, workspace)

        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "workspace.message.posted",
            "target_agents": "alpha",
        }, headers={"X-Workspace-Token": workspace["token"]})
        data = resp.json()["data"]

        # ev-noresp is the newest event in the stream even though it wasn't
        # returned; next_cursor must point there so the next poll starts past it.
        assert data["has_more"] is False
        assert data["next_cursor"] == "ev-noresp"

    def test_absent_param_is_unchanged_broadcast(self, client, workspace, db):
        """No target_agents param → legacy behavior: every event returned,
        no next_cursor field (backward compatible)."""
        self._seed(db, workspace)

        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "workspace.message.posted",
        }, headers={"X-Workspace-Token": workspace["token"]})
        data = resp.json()["data"]
        ids = {e["id"] for e in data["events"]}
        assert {"ev-a", "ev-b", "ev-ab", "ev-human-none", "ev-agent-none", "ev-noresp"} <= ids
        assert "next_cursor" not in data


class TestPollResolveCache:
    """The workspace resolve+auth is served from Redis so at-head polls don't
    hit Postgres. The cache must never bypass auth.
    """

    def _use_memory_cache(self, monkeypatch):
        """Swap the Redis helpers for an in-memory dict so the cache-hit path
        (normally a no-op in tests, where Redis is disabled) is exercised."""
        from app import cache as _cache
        store = {}
        monkeypatch.setattr(_cache, "get_bytes", lambda k: store.get(k))
        monkeypatch.setattr(_cache, "set_bytes", lambda k, v, ttl_seconds=0.0: store.__setitem__(k, v))
        monkeypatch.setattr(_cache, "delete_key", lambda k: store.pop(k, None))
        return store

    def test_cache_hit_still_enforces_token(self, client, workspace, monkeypatch):
        store = self._use_memory_cache(monkeypatch)
        params = {"network": workspace["id"], "type": "workspace.message.posted"}
        good = {"X-Workspace-Token": workspace["token"]}

        # 1) first poll resolves via DB and populates the resolve cache
        r1 = client.get("/v1/events", params=params, headers=good)
        assert r1.status_code == 200
        assert any(k.startswith("v1ws:resolve:") for k in store), "resolve cache should be populated"

        # 2) second poll is served with the cache warm — still authorized
        r2 = client.get("/v1/events", params=params, headers=good)
        assert r2.status_code == 200

        # 3) a wrong token with the cache warm is STILL rejected — the cached
        # token-hash must not let a bad token through (it falls through to DB auth)
        r3 = client.get("/v1/events", params=params, headers={"X-Workspace-Token": "wrong-token"})
        assert r3.status_code == 401

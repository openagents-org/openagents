# -*- coding: utf-8 -*-
"""
Tests for per-channel context projection (`context_mode` + `view_for`).

The projection exists so that in a multi-role thread an agent rebuilds its
context from its own slice of the conversation instead of from every other
role's verbatim discussion. Two properties matter more than the filtering
itself and are asserted throughout:

  - It reduces bytes, never rows. A digested turn still appears, still names
    its sender, and still carries the id needed to read it in full.
  - It fails open. Anything the server can't resolve (no channel, unknown
    channel, mode absent) serves the full stream rather than guessing.

Events are inserted directly rather than posted through /v1/events, because
the pipeline computes `target_agents` itself and these tests need to pin
specific routing outcomes.
"""

import pytest

from app.context_projection import digest_text, sees_in_full, should_project
from app.models import Channel, EventRecord
from app.services.cloud_agent import _build_conversation_context


def _insert(db, workspace_id, channel_name, *, event_id, source,
            content, target_agents=None, ts=1_000, type_="workspace.message.posted",
            attachments=None, payload=None):
    """Insert one event row with an exact routing outcome."""
    metadata = {}
    if target_agents is not None:
        metadata["target_agents"] = target_agents
    body = payload if payload is not None else {"content": content}
    if attachments is not None:
        body["attachments"] = attachments
    db.add(EventRecord(
        id=event_id,
        network_id=workspace_id,
        type=type_,
        source=source,
        target=f"channel/{channel_name}",
        payload=body,
        metadata_=metadata,
        timestamp=ts,
        visibility="channel",
    ))
    db.commit()


def _set_context_mode(db, workspace_id, channel_name, mode):
    channel = db.query(Channel).filter(
        Channel.workspace_id == workspace_id,
        Channel.name == channel_name,
    ).one()
    channel.context_mode = mode
    db.commit()


def _poll(client, workspace, *, view_for=None, channel=None):
    params = {
        "network": workspace["id"],
        "type": "workspace.message",
        "sort": "asc",
        "limit": "50",
    }
    if channel is not None:
        params["channel"] = channel
    if view_for is not None:
        params["view_for"] = view_for
    resp = client.get("/v1/events", params=params,
                      headers={"X-Workspace-Token": workspace["token"]})
    assert resp.status_code == 200
    return resp.json()["data"]["events"]


def _by_id(events):
    return {e["id"]: e for e in events}


LONG_BODY = (
    "The export format question is settled: CSV.\n"
    "Here is the rest of a very long product discussion that an engineer has "
    "no reason to read verbatim, going on well past any reasonable one-line "
    "summary and continuing for a while longer still."
)


class TestSharedModeIsUnchanged:
    """`shared` is the default, and `view_for` must be inert under it."""

    def test_default_mode_is_shared(self, client, workspace):
        resp = client.get(
            f"/v1/workspaces/{workspace['id']}/channels/{workspace['channel']['name']}",
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["contextMode"] == "shared"

    def test_view_for_is_a_noop_in_shared_mode(self, client, workspace, db):
        channel = workspace["channel"]["name"]
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"])

        events = _poll(client, workspace, view_for="rd-agent", channel=channel)

        assert len(events) == 1
        assert events[0]["payload"]["content"] == LONG_BODY
        assert "truncated" not in events[0]


class TestProjectedMode:
    """What each agent sees once the channel opts in."""

    @pytest.fixture
    def channel(self, workspace, db):
        name = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], name, "projected")
        return name

    def test_own_messages_come_back_in_full(self, client, workspace, db, channel):
        """An agent must never lose its own words — that is worse than noise."""
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:rd-agent", content=LONG_BODY,
                target_agents=["__no_response__"])

        events = _poll(client, workspace, view_for="rd-agent", channel=channel)

        assert events[0]["payload"]["content"] == LONG_BODY
        assert "truncated" not in events[0]

    def test_human_messages_come_back_in_full_even_when_addressed_elsewhere(
        self, client, workspace, db, channel
    ):
        """A requirement is still a requirement when aimed at another agent.

        This is exactly where the delivery filter (`target_agents`) and the
        context view diverge: delivery scopes human messages to the untargeted
        ones, context keeps all of them.
        """
        _insert(db, workspace["id"], channel, event_id="e1",
                source="human:alice", content=LONG_BODY,
                target_agents=["qa-agent"])

        events = _poll(client, workspace, view_for="rd-agent", channel=channel)

        assert events[0]["payload"]["content"] == LONG_BODY
        assert "truncated" not in events[0]

    def test_messages_routed_to_me_come_back_in_full(self, client, workspace, db, channel):
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["rd-agent"])

        events = _poll(client, workspace, view_for="rd-agent", channel=channel)

        assert events[0]["payload"]["content"] == LONG_BODY
        assert "truncated" not in events[0]

    def test_another_agents_turn_is_digested_not_dropped(self, client, workspace, db, channel):
        """The row survives; only the bytes shrink."""
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"])

        events = _poll(client, workspace, view_for="rd-agent", channel=channel)

        assert len(events) == 1, "a digested turn must still appear"
        event = events[0]
        assert event["truncated"] is True
        assert event["payload"]["truncated"] is True
        assert event["source"] == "openagents:pm-agent", "sender must survive"
        assert event["id"] == "e1", "id must survive so the turn can be expanded"
        # First line only, and short.
        assert event["payload"]["content"] == "The export format question is settled: CSV."
        assert len(event["payload"]["content"]) <= 121

    def test_long_first_line_is_clipped_with_an_ellipsis(self, client, workspace, db, channel):
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content="x" * 500,
                target_agents=["qa-agent"])

        events = _poll(client, workspace, view_for="rd-agent", channel=channel)

        content = events[0]["payload"]["content"]
        assert content.endswith("…")
        assert len(content) == 121

    def test_attachments_survive_digesting(self, client, workspace, db, channel):
        """A shared file is an artifact for other roles, not conversation."""
        attachments = [{"filename": "spec.md", "fileId": "f-1"}]
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"], attachments=attachments)

        events = _poll(client, workspace, view_for="rd-agent", channel=channel)

        assert events[0]["truncated"] is True
        assert events[0]["payload"]["attachments"] == attachments

    def test_message_type_survives_digesting(self, client, workspace, db, channel):
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent",
                content=LONG_BODY, target_agents=["qa-agent"],
                payload={"content": LONG_BODY, "message_type": "chat"})

        events = _poll(client, workspace, view_for="rd-agent", channel=channel)

        assert events[0]["payload"]["message_type"] == "chat"

    def test_non_message_events_are_never_digested(self, client, workspace, db, channel):
        """Clients parse these structurally — truncating corrupts, not summarizes."""
        todos = {"todos": [{"content": "ship it", "status": "pending"}]}
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content="",
                target_agents=["qa-agent"], type_="workspace.todos.updated",
                payload=todos)

        params = {
            "network": workspace["id"], "channel": channel,
            "sort": "asc", "limit": "50", "view_for": "rd-agent",
        }
        resp = client.get("/v1/events", params=params,
                          headers={"X-Workspace-Token": workspace["token"]})
        events = resp.json()["data"]["events"]

        assert events[0]["payload"] == todos
        assert "truncated" not in events[0]

    def test_each_agent_gets_its_own_view_of_the_same_stream(
        self, client, workspace, db, channel
    ):
        """The point of the feature, asserted end to end."""
        _insert(db, workspace["id"], channel, event_id="e-human",
                source="human:alice", content="Build the export", ts=1)
        _insert(db, workspace["id"], channel, event_id="e-pm",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"], ts=2)
        _insert(db, workspace["id"], channel, event_id="e-rd",
                source="openagents:rd-agent", content="Implementation detail: " + LONG_BODY,
                target_agents=["__no_response__"], ts=3)

        rd_view = _by_id(_poll(client, workspace, view_for="rd-agent", channel=channel))
        pm_view = _by_id(_poll(client, workspace, view_for="pm-agent", channel=channel))

        # Same rows for both — nothing disappears for anyone.
        assert set(rd_view) == set(pm_view) == {"e-human", "e-pm", "e-rd"}
        # The human message is full for both.
        assert "truncated" not in rd_view["e-human"]
        assert "truncated" not in pm_view["e-human"]
        # Each sees its own turn in full and the other's as a digest.
        assert "truncated" not in rd_view["e-rd"]
        assert rd_view["e-pm"]["truncated"] is True
        assert "truncated" not in pm_view["e-pm"]
        assert pm_view["e-rd"]["truncated"] is True


class TestFailsOpen:
    """Unresolvable projection state must serve the full stream, not a guess."""

    def test_view_for_without_a_channel_is_a_noop(self, client, workspace, db):
        """No channel means no mode to read — do not project on a hunch."""
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"])

        events = _poll(client, workspace, view_for="rd-agent")  # no channel=

        assert events[0]["payload"]["content"] == LONG_BODY
        assert "truncated" not in events[0]

    def test_unknown_channel_serves_full_content(self, client, workspace, db):
        channel = workspace["channel"]["name"]
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"])

        # Events are filtered by the (nonexistent) channel, so this asserts the
        # lookup path doesn't raise; the projection simply never engages.
        resp = client.get("/v1/events", params={
            "network": workspace["id"], "channel": "no-such-channel",
            "type": "workspace.message", "view_for": "rd-agent",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        assert resp.json()["data"]["events"] == []

    def test_no_view_for_serves_full_content_in_projected_channel(
        self, client, workspace, db
    ):
        """A client that never asks for a view is unaffected by the setting."""
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"])

        events = _poll(client, workspace, channel=channel)

        assert events[0]["payload"]["content"] == LONG_BODY


class TestExpandEndpoint:
    """GET /v1/events/{id} — the escape hatch that makes projection safe."""

    def test_expands_a_digested_message_in_full(self, client, workspace, db):
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")
        _insert(db, workspace["id"], channel, event_id="e1",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"])

        digest = _poll(client, workspace, view_for="rd-agent", channel=channel)[0]
        assert digest["truncated"] is True

        resp = client.get(f"/v1/events/{digest['id']}",
                          params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        full = resp.json()["data"]
        assert full["payload"]["content"] == LONG_BODY
        assert "truncated" not in full

    def test_unknown_event_returns_404(self, client, workspace):
        resp = client.get("/v1/events/no-such-event",
                          params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 404

    def test_requires_credentials(self, client, workspace, db):
        channel = workspace["channel"]["name"]
        _insert(db, workspace["id"], channel, event_id="e1",
                source="human:alice", content="secret")

        resp = client.get("/v1/events/e1", params={"network": workspace["id"]})

        assert resp.status_code == 401

    def test_does_not_leak_across_workspaces(self, client, workspace, db):
        """The id is the only input — it must still be scoped to the caller."""
        channel = workspace["channel"]["name"]
        _insert(db, workspace["id"], channel, event_id="e1",
                source="human:alice", content="secret")

        other = client.post("/v1/workspaces", json={
            "name": "Other", "agent_name": "agent-beta",
            "creator_email": "other@example.com",
        }).json()["data"]

        resp = client.get("/v1/events/e1", params={"network": other["workspaceId"]},
                          headers={"X-Workspace-Token": other["token"]})

        assert resp.status_code == 404

    def test_static_event_routes_are_not_shadowed(self, client, workspace):
        """`/events/{id}` is declared last so these keep resolving."""
        resp = client.get("/v1/events/conversations",
                          params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        assert "conversations" in resp.json()["data"]


class TestReadersThatCannotExpand:
    """The projection is gated on the READER, not only on the channel.

    An excerpt is a reduction only for someone who can fetch the full text. For
    a reader that cannot, it is silent deletion — so those readers keep the
    whole stream even in a projected channel.
    """

    def test_should_project_refuses_a_reader_that_cannot_expand(self, client, workspace, db):
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")

        assert should_project(
            db, workspace["id"], channel, "rd-agent", viewer_can_expand=True,
        ) is True
        assert should_project(
            db, workspace["id"], channel, "rd-agent", viewer_can_expand=False,
        ) is False

    def test_should_project_fails_open_without_a_channel_or_viewer(self, client, workspace, db):
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")

        assert should_project(db, workspace["id"], None, "rd", viewer_can_expand=True) is False
        assert should_project(db, workspace["id"], channel, None, viewer_can_expand=True) is False

    def test_shared_channel_never_projects(self, client, workspace, db):
        channel = workspace["channel"]["name"]
        assert should_project(
            db, workspace["id"], channel, "rd-agent", viewer_can_expand=True,
        ) is False


class TestCloudAgentContext:
    """Cloud agents are a second read path into the same channel.

    They assemble context straight from EventRecord rather than over HTTP, so
    without routing through the shared policy a projected channel would isolate
    its connector-backed agents while a cloud agent kept reading everything.
    They have no tool loop, so today the policy answers "serve it in full" —
    the assertion here is that the answer is DELIBERATE and centralized, not
    that the path was never considered.
    """

    def _seed(self, db, workspace, channel):
        _insert(db, workspace["id"], channel, event_id="e-human",
                source="human:alice", content="Build the export", ts=1)
        _insert(db, workspace["id"], channel, event_id="e-pm",
                source="openagents:pm-agent", content=LONG_BODY,
                target_agents=["qa-agent"], ts=2)
        _insert(db, workspace["id"], channel, event_id="e-cloud",
                source="openagents:cloud-agent", content="My own earlier answer",
                target_agents=["__no_response__"], ts=3)
        # _build_conversation_context drops the newest row (the triggering
        # message), so add one that is meant to be discarded.
        _insert(db, workspace["id"], channel, event_id="e-trigger",
                source="human:alice", content="and now this", ts=4)

    def test_cloud_agent_reads_the_full_thread_in_a_projected_channel(
        self, workspace, db
    ):
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")
        self._seed(db, workspace, channel)

        messages = _build_conversation_context(
            db, workspace["id"], f"channel/{channel}", "cloud-agent",
        )

        contents = [m["content"] for m in messages]
        assert LONG_BODY in contents, (
            "a reader with no way to expand an excerpt must not be given one"
        )

    def test_cloud_agent_context_is_unchanged_in_a_shared_channel(self, workspace, db):
        channel = workspace["channel"]["name"]
        self._seed(db, workspace, channel)

        messages = _build_conversation_context(
            db, workspace["id"], f"channel/{channel}", "cloud-agent",
        )

        assert [m["content"] for m in messages] == [
            "Build the export", LONG_BODY, "My own earlier answer",
        ]
        assert [m["role"] for m in messages] == ["user", "user", "assistant"]

    def test_cloud_agent_warns_when_a_projected_channel_cannot_isolate_it(
        self, workspace, db, caplog
    ):
        """The gap has to be visible to whoever turned the setting on."""
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")
        self._seed(db, workspace, channel)

        with caplog.at_level("WARNING"):
            _build_conversation_context(
                db, workspace["id"], f"channel/{channel}", "cloud-agent",
            )

        assert "cannot expand" in caplog.text
        assert "cloud agent cloud-agent" in caplog.text

    def test_the_warning_is_rate_limited(self, workspace, db, caplog):
        """It fires on a hot path — a chatty cloud agent hits it every turn,
        and a warning that repeats hundreds of times an hour stops being read.
        """
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")
        self._seed(db, workspace, channel)

        with caplog.at_level("WARNING"):
            for _ in range(5):
                _build_conversation_context(
                    db, workspace["id"], f"channel/{channel}", "cloud-agent",
                )

        hits = [r for r in caplog.records if "cannot expand" in r.getMessage()]
        assert len(hits) == 1, f"expected one warning, got {len(hits)}"

    def test_a_different_reader_still_warns(self, workspace, db, caplog):
        """Rate limiting is per (channel, reader) — it must not mask a second
        agent hitting the same gap."""
        channel = workspace["channel"]["name"]
        _set_context_mode(db, workspace["id"], channel, "projected")
        self._seed(db, workspace, channel)

        with caplog.at_level("WARNING"):
            _build_conversation_context(
                db, workspace["id"], f"channel/{channel}", "cloud-agent",
            )
            _build_conversation_context(
                db, workspace["id"], f"channel/{channel}", "other-cloud-agent",
            )

        hits = [r for r in caplog.records if "cannot expand" in r.getMessage()]
        assert len(hits) == 2

    def test_projection_would_apply_once_a_cloud_agent_can_expand(self, workspace, db):
        """Guards the wiring, so flipping the capability is a one-line change.

        Asserts the policy pieces the cloud path uses, not the current answer:
        if someone gives cloud agents a tool loop, this is what starts firing.
        """
        assert sees_in_full("openagents:cloud-agent", {}, "cloud-agent") is True
        assert sees_in_full("human:alice", {"target_agents": ["x"]}, "cloud-agent") is True
        assert sees_in_full("openagents:pm", {"target_agents": ["qa"]}, "cloud-agent") is False
        assert digest_text(LONG_BODY) == "The export format question is settled: CSV."


class TestContextModeSetting:
    """PATCH /v1/workspaces/{id}/channels/{name}."""

    def _patch(self, client, workspace, body):
        return client.patch(
            f"/v1/workspaces/{workspace['id']}/channels/{workspace['channel']['name']}",
            json=body, headers={"X-Workspace-Token": workspace["token"]},
        )

    def test_can_switch_to_projected(self, client, workspace):
        resp = self._patch(client, workspace, {"context_mode": "projected"})
        assert resp.status_code == 200
        assert resp.json()["data"]["contextMode"] == "projected"

    def test_can_switch_back_to_shared(self, client, workspace):
        self._patch(client, workspace, {"context_mode": "projected"})
        resp = self._patch(client, workspace, {"context_mode": "shared"})
        assert resp.json()["data"]["contextMode"] == "shared"

    def test_is_case_insensitive(self, client, workspace):
        resp = self._patch(client, workspace, {"context_mode": "PROJECTED"})
        assert resp.json()["data"]["contextMode"] == "projected"

    def test_rejects_an_unknown_mode(self, client, workspace):
        resp = self._patch(client, workspace, {"context_mode": "private"})
        assert resp.status_code == 400

    def test_other_channel_updates_leave_it_alone(self, client, workspace):
        self._patch(client, workspace, {"context_mode": "projected"})
        resp = self._patch(client, workspace, {"title": "Renamed"})
        assert resp.json()["data"]["contextMode"] == "projected"

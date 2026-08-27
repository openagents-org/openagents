# -*- coding: utf-8 -*-
"""
Tests for the Kanban task board (/v1/tasks).

Covers the CRUD surface plus the assign flow (which spins up the hidden
`task:<id>` thread and kicks the agent off) and the human-unblock transition
in the workspace-mod progress hook.
"""

from sqlalchemy import select

from app.mods.workspace_mod import _handle_task_thread_progress
from app.models import Channel, KanbanTask, Workspace
from openagents.core.onm_events import Event


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _create(client, workspace, **overrides):
    body = {"network": workspace["id"], "title": "Fix the login bug"}
    body.update(overrides)
    return client.post("/v1/tasks", json=body, headers=_headers(workspace))


class TestTaskCrud:
    def test_create_defaults_to_backlog(self, client, workspace):
        resp = _create(client, workspace)
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["status"] == "backlog"
        assert data["title"] == "Fix the login bug"
        assert data["assignee"] is None
        assert data["channel_name"] is None

    def test_create_requires_title_or_description(self, client, workspace):
        resp = _create(client, workspace, title="   ")
        assert resp.status_code != 200 or resp.json().get("code") != 0

    def test_untitled_task_derives_preview_from_description(self, client, workspace):
        resp = _create(
            client, workspace, title="",
            description="Fix the login redirect loop that users hit after resetting their password on mobile",
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["title"] == "Fix the login redirect loop that users hit…"
        # Short descriptions come through whole, no ellipsis.
        short = _create(client, workspace, title="", description="Update the README").json()["data"]
        assert short["title"] == "Update the README"

    def test_patch_cleared_title_rederives(self, client, workspace):
        task = _create(client, workspace, title="Old title", description="Ship the beta release notes").json()["data"]
        resp = client.patch(
            f"/v1/tasks/{task['id']}",
            json={"network": workspace["id"], "title": ""},
            headers=_headers(workspace),
        )
        assert resp.json()["data"]["title"] == "Ship the beta release notes"

    def test_list_returns_created(self, client, workspace):
        _create(client, workspace, title="A")
        _create(client, workspace, title="B")
        resp = client.get(f"/v1/tasks?network={workspace['id']}", headers=_headers(workspace))
        assert resp.status_code == 200, resp.text
        titles = {t["title"] for t in resp.json()["data"]["tasks"]}
        assert {"A", "B"} <= titles

    def test_patch_moves_column(self, client, workspace):
        task = _create(client, workspace).json()["data"]
        resp = client.patch(
            f"/v1/tasks/{task['id']}",
            json={"network": workspace["id"], "status": "todo", "priority": "high"},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["status"] == "todo"
        assert data["priority"] == "high"

    def test_delete_archives_thread(self, client, workspace, db):
        task = _create(client, workspace).json()["data"]
        client.post(
            f"/v1/tasks/{task['id']}/assign",
            json={"network": workspace["id"], "agent": "agent-alpha"},
            headers=_headers(workspace),
        )
        resp = client.delete(f"/v1/tasks/{task['id']}?network={workspace['id']}", headers=_headers(workspace))
        assert resp.status_code == 200, resp.text
        # Task gone; its channel archived.
        assert db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one_or_none() is None
        channel = db.execute(
            select(Channel).where(Channel.name == f"task:{task['id']}")
        ).scalar_one_or_none()
        assert channel is not None and channel.status == "deleted"


class TestKnowledgeContext:
    def _seed_entry(self, db, workspace, slug="deploy-notes", title="Deploy notes"):
        from app.models import KnowledgeEntry
        entry = KnowledgeEntry(
            workspace_id=workspace["id"], slug=slug, title=title,
            created_by="human:user", status="active",
        )
        db.add(entry)
        db.commit()
        return entry

    def test_create_validates_knowledge_ids(self, client, workspace, db):
        entry = self._seed_entry(db, workspace)
        resp = _create(client, workspace, knowledge_ids=[entry.id, "bogus-id"])
        assert resp.status_code == 200, resp.text
        # The bogus id is silently dropped; the real one sticks.
        assert resp.json()["data"]["knowledge_ids"] == [entry.id]

    def test_update_clears_with_empty_list(self, client, workspace, db):
        entry = self._seed_entry(db, workspace)
        task = _create(client, workspace, knowledge_ids=[entry.id]).json()["data"]
        resp = client.patch(
            f"/v1/tasks/{task['id']}",
            json={"network": workspace["id"], "knowledge_ids": []},
            headers=_headers(workspace),
        )
        assert resp.json()["data"]["knowledge_ids"] == []

    def test_kickoff_references_knowledge_slugs(self, client, workspace, db):
        from app.models import EventRecord
        entry = self._seed_entry(db, workspace, slug="style-guide", title="Style guide")
        task = _create(client, workspace, assignee="agent-alpha", knowledge_ids=[entry.id]).json()["data"]
        client.post(
            f"/v1/tasks/{task['id']}/assign",
            json={"network": workspace["id"]},
            headers=_headers(workspace),
        )
        events = db.execute(
            select(EventRecord).where(
                EventRecord.target == f"channel/task:{task['id']}",
                EventRecord.type == "workspace.message.posted",
            )
        ).scalars().all()
        kickoff = next(e for e in events if "assigned this Kanban task" in ((e.payload or {}).get("content") or ""))
        content = kickoff.payload["content"]
        assert "@knowledge:style-guide" in content
        assert "Style guide" in content


class TestAssign:
    def test_assign_creates_thread_and_moves_in_progress(self, client, workspace, db):
        task = _create(client, workspace).json()["data"]
        resp = client.post(
            f"/v1/tasks/{task['id']}/assign",
            json={"network": workspace["id"], "agent": "agent-alpha"},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["assignee"] == "agent-alpha"
        assert data["status"] == "in_progress"
        assert data["channel_name"] == f"task:{task['id']}"

        # The hidden thread exists with the agent as master.
        channel = db.execute(
            select(Channel).where(Channel.name == f"task:{task['id']}")
        ).scalar_one_or_none()
        assert channel is not None
        assert channel.master_agent == "agent-alpha"

    def test_preassign_does_not_run(self, client, workspace, db):
        """Creating a task with an assignee records it but does NOT start work."""
        resp = _create(client, workspace, assignee="agent-alpha")
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["assignee"] == "agent-alpha"
        assert data["status"] == "backlog"     # not running
        assert data["channel_name"] is None    # no thread yet

    def test_run_falls_back_to_stored_assignee(self, client, workspace, db):
        """POST /assign with no agent runs the task's pre-set assignee."""
        task = _create(client, workspace, assignee="agent-alpha").json()["data"]
        resp = client.post(
            f"/v1/tasks/{task['id']}/assign",
            json={"network": workspace["id"]},   # no agent — use stored assignee
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["assignee"] == "agent-alpha"
        assert data["status"] == "in_progress"
        assert data["channel_name"] == f"task:{task['id']}"

    def test_assign_rejects_non_member(self, client, workspace):
        task = _create(client, workspace).json()["data"]
        resp = client.post(
            f"/v1/tasks/{task['id']}/assign",
            json={"network": workspace["id"], "agent": "ghost-agent"},
            headers=_headers(workspace),
        )
        # FORBIDDEN — either non-200 HTTP or a non-zero response code envelope.
        assert resp.status_code != 200 or resp.json().get("code") != 0


class TestProgressHook:
    """Exercise the workspace-mod hook directly.

    Going through POST /v1/events would schedule the push-fanout background
    task, which needs a real Postgres (unavailable in unit tests) — the same
    reason parts of test_events.py can't run locally. The hook is pure DB work,
    so we drive it in isolation.
    """

    def _setup_assigned(self, client, workspace, db):
        task = _create(client, workspace).json()["data"]
        client.post(
            f"/v1/tasks/{task['id']}/assign",
            json={"network": workspace["id"], "agent": "agent-alpha"},
            headers=_headers(workspace),
        )
        ws = db.execute(select(Workspace).where(Workspace.id == workspace["id"])).scalar_one()
        channel = db.execute(
            select(Channel).where(Channel.name == f"task:{task['id']}")
        ).scalar_one()
        return task, ws, channel

    def _event(self, channel_name, source, content):
        return Event(
            type="workspace.message.posted",
            source=source,
            target=f"channel/{channel_name}",
            payload={"content": content},
            metadata={},
        )

    def test_human_reply_unblocks_need_input(self, client, workspace, db):
        task, ws, channel = self._setup_assigned(client, workspace, db)

        # Simulate the agent having parked the card in Need Input.
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        row.status = "need_input"
        db.commit()

        _handle_task_thread_progress(
            self._event(channel.name, "human:user", "Use the staging database."),
            channel, "Use the staging database.", db, ws,
        )
        db.commit()

        db.expire_all()
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        assert row.status == "in_progress"

    def test_agent_reply_without_llm_stays_in_progress(self, client, workspace, db):
        # No router API key configured in tests → classifier falls back to
        # in_progress and the card must not crash or move.
        task, ws, channel = self._setup_assigned(client, workspace, db)

        _handle_task_thread_progress(
            self._event(channel.name, "openagents:agent-alpha", "Still working on it."),
            channel, "Still working on it.", db, ws,
        )
        db.commit()

        db.expire_all()
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        assert row.status == "in_progress"

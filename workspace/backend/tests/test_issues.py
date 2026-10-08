"""Issues are passive discussions until a member explicitly starts work."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import func, select

from app.models import Channel, EventRecord, KanbanTask, WorkspaceMember
from app.routers.tasks import _context_block


def headers(ws):
    return {"X-Workspace-Token": ws["token"]}


def path(ws, suffix=""):
    return f"/v1/issues{suffix}?network={ws['id']}"


def create(client, ws, **kwargs):
    response = client.post(
        path(ws),
        headers=headers(ws),
        json={
            "title": "Improve onboarding",
            "description": "People cannot find their first step.",
            "source": "human:alice",
            **kwargs,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def detail(client, ws, issue):
    response = client.get(path(ws, f"/{issue['id']}"), headers=headers(ws))
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_discussion_never_routes_agents(client, workspace, db):
    before = db.scalar(select(func.count()).select_from(Channel))
    with patch("app.routers.issues._emit_event_blocking") as emit:
        issue = create(client, workspace)
        response = client.post(
            path(workspace, f"/{issue['id']}/comments"),
            headers=headers(workspace),
            json={
                "content": "@agent-alpha Let's discuss first.",
                "source": "human:bob",
            },
        )
        assert response.status_code == 200
        assert response.json()["data"]["author"] == "human:bob"
        emit.assert_not_called()
    assert db.scalar(select(func.count()).select_from(Channel)) == before
    result = detail(client, workspace, issue)
    assert result["status"] == "open" and len(result["comments"]) == 1
    assert result["threads"] == result["tasks"] == []


@pytest.mark.parametrize("payload", [{"title": " "}, {"title": "x" * 241}])
def test_invalid_issue_rejected(client, workspace, payload):
    assert (
        client.post(
            path(workspace), json=payload, headers=headers(workspace)
        ).status_code
        == 422
    )


def test_status_validation_history_and_reopen(client, workspace):
    issue = create(client, workspace)
    url = path(workspace, f"/{issue['id']}")
    for payload in ({"status": "invalid"}, {"title": " "}):
        assert (
            client.patch(url, json=payload, headers=headers(workspace)).status_code
            == 422
        )
    for status in ("in_progress", "closed", "open"):
        assert (
            client.patch(
                url,
                json={"status": status, "source": "human:bob"},
                headers=headers(workspace),
            ).json()["data"]["status"]
            == status
        )
    result = detail(client, workspace, issue)
    assert [c["content"] for c in result["comments"]] == [
        "open → in_progress",
        "in_progress → closed",
        "closed → open",
    ]
    assert all(c["author"] == "human:bob" for c in result["comments"])
    assert (
        client.post(
            path(workspace, f"/{issue['id']}/comments"),
            json={"content": " "},
            headers=headers(workspace),
        ).status_code
        == 422
    )


def test_pagination_search_and_filter(client, workspace):
    first = create(client, workspace, title="Search 100% done")
    create(client, workspace, title="Another idea")
    client.patch(
        path(workspace, f"/{first['id']}"),
        json={"status": "closed"},
        headers=headers(workspace),
    )
    page = client.get(path(workspace) + "&limit=1", headers=headers(workspace)).json()[
        "data"
    ]
    other = client.get(
        path(workspace) + "&limit=1&offset=1", headers=headers(workspace)
    ).json()["data"]
    assert page["next_offset"] == 1 and other["next_offset"] is None
    assert page["issues"][0]["id"] != other["issues"][0]["id"]
    rows = client.get(
        path(workspace) + "&status=closed&q=100%25", headers=headers(workspace)
    ).json()["data"]["issues"]
    assert [i["id"] for i in rows] == [first["id"]]


def test_workspace_isolation_and_credentials(client, workspace):
    issue = create(client, workspace)
    raw = client.post(
        "/v1/workspaces", json={"name": "Other", "agent_name": "other-agent"}
    ).json()["data"]
    other = {"id": raw["workspaceId"], "token": raw["token"]}
    assert (
        client.get(path(workspace), headers={"X-Workspace-Token": "wrong"}).status_code
        == 403
    )
    assert (
        client.get(path(other, f"/{issue['id']}"), headers=headers(other)).status_code
        == 404
    )
    assert (
        client.patch(
            path(other, f"/{issue['id']}"),
            json={"status": "closed"},
            headers=headers(other),
        ).status_code
        == 404
    )
    assert (
        client.post(
            path(other, f"/{issue['id']}/comments"),
            json={"content": "no"},
            headers=headers(other),
        ).status_code
        == 404
    )
    assert (
        client.post(
            path(other),
            json={
                "title": "Cross workspace",
                "channel_name": workspace["channel"]["name"],
            },
            headers=headers(other),
        ).status_code
        == 404
    )


def test_viewer_can_read_but_cannot_mutate(client, workspace):
    issue = create(client, workspace)
    with patch("app.access.resolve_user_role", return_value="viewer"):
        auth = {"Authorization": "Bearer viewer"}
        assert client.get(path(workspace), headers=auth).status_code == 200
        assert (
            client.get(path(workspace, f"/{issue['id']}"), headers=auth).status_code
            == 200
        )
        for suffix, body in [
            ("", {"title": "No"}),
            (f"/{issue['id']}/comments", {"content": "No"}),
            (
                f"/{issue['id']}/threads",
                {"agents": ["agent-alpha"], "instruction": "No"},
            ),
            (f"/{issue['id']}/tasks", {"title": "No"}),
            (f"/{issue['id']}/links", {"channel_name": workspace["channel"]["name"]}),
        ]:
            assert (
                client.post(
                    path(workspace, suffix), json=body, headers=auth
                ).status_code
                == 403
            )
        assert (
            client.patch(
                path(workspace, f"/{issue['id']}"),
                json={"status": "closed"},
                headers=auth,
            ).status_code
            == 403
        )


def test_verified_author_wins_over_client_source(client, workspace):
    with patch(
        "app.routers.issues.resolve_current_user",
        return_value=SimpleNamespace(email="alice@example.com"),
    ):
        issue = create(client, workspace, source="human:someone-else")
    assert issue["created_by"] == "human:alice@example.com"


def test_promote_and_link_existing_thread_is_idempotent(client, workspace):
    with patch("app.routers.issues._emit_event_blocking") as emit:
        issue = create(client, workspace, channel_name=workspace["channel"]["name"])
        for _ in range(2):
            assert (
                client.post(
                    path(workspace, f"/{issue['id']}/links"),
                    headers=headers(workspace),
                    json={"channel_name": workspace["channel"]["name"]},
                ).status_code
                == 200
            )
        emit.assert_not_called()
    assert len(detail(client, workspace, issue)["threads"]) == 1


def test_start_agent_work_with_discussion_context(client, workspace, db):
    issue = create(client, workspace)
    db.add(WorkspaceMember(workspace_id=workspace["id"], agent_name="agent-beta"))
    db.commit()
    client.post(
        path(workspace, f"/{issue['id']}/comments"),
        headers=headers(workspace),
        json={"content": "Keep the first screen simple."},
    )
    response = client.post(
        path(workspace, f"/{issue['id']}/threads"),
        headers=headers(workspace),
        json={
            "agents": ["agent-alpha", "openagents:agent-beta"],
            "instruction": "Investigate and propose options",
            "source": "human:alice",
        },
    )
    assert response.status_code == 200, response.text
    name = response.json()["data"]["channel_name"]
    result = detail(client, workspace, issue)
    assert result["status"] == "in_progress"
    assert set(result["threads"][0]["agents"]) == {"agent-alpha", "agent-beta"}
    event = (
        db.execute(
            select(EventRecord).where(
                EventRecord.target == f"channel/{name}",
                EventRecord.type == "workspace.message.posted",
            )
        )
        .scalars()
        .first()
    )
    assert event is not None and event.source == "human:alice"
    for expected in (
        "Keep the first screen simple.",
        "Investigate and propose options",
        "People cannot find their first step",
    ):
        assert expected in event.payload["content"]


def test_invalid_agent_or_closed_issue_cannot_start_work(client, workspace, db):
    issue = create(client, workspace)
    before = db.scalar(select(func.count()).select_from(Channel))
    url = path(workspace, f"/{issue['id']}/threads")
    for agents in (["outsider"], [], [""]):
        assert (
            client.post(
                url,
                headers=headers(workspace),
                json={"agents": agents, "instruction": "Investigate"},
            ).status_code
            == 422
        )
    assert db.scalar(select(func.count()).select_from(Channel)) == before
    client.patch(
        path(workspace, f"/{issue['id']}"),
        headers=headers(workspace),
        json={"status": "closed"},
    )
    assert (
        client.post(
            url,
            headers=headers(workspace),
            json={"agents": ["agent-alpha"], "instruction": "Investigate"},
        ).status_code
        == 409
    )


def seed_reply(
    db, ws, event_id, source="openagents:agent-alpha", message_type="chat", timestamp=1
):
    db.add(
        EventRecord(
            id=event_id,
            network_id=ws["id"],
            type="workspace.message.posted",
            source=source,
            target=f"channel/{ws['channel']['name']}",
            payload={"content": "Here are my findings.", "message_type": message_type},
            timestamp=timestamp,
        )
    )
    db.commit()


def test_share_results_preserves_attribution_and_is_idempotent(client, workspace, db):
    issue = create(client, workspace, channel_name=workspace["channel"]["name"])
    seed_reply(db, workspace, "reply")
    seed_reply(db, workspace, "thinking", message_type="thinking", timestamp=2)
    assert (
        detail(client, workspace, issue)["threads"][0]["latest_reply"]["id"] == "reply"
    )
    for _ in range(2):
        response = client.post(
            path(workspace, f"/{issue['id']}/comments"),
            headers=headers(workspace),
            json={
                "source_event_id": "reply",
                "source": "human:bob",
                "content": "forged",
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["data"]["author"] == "openagents:agent-alpha"
        assert response.json()["data"]["content"] == "Here are my findings."
    result = detail(client, workspace, issue)
    assert len(result["comments"]) == 1 and result["status"] == "open"


def test_cannot_share_unlinked_or_nonchat_result(client, workspace, db):
    issue = create(client, workspace)
    seed_reply(db, workspace, "unlinked")
    url = path(workspace, f"/{issue['id']}/comments")
    assert (
        client.post(
            url, headers=headers(workspace), json={"source_event_id": "unlinked"}
        ).status_code
        == 404
    )
    client.post(
        path(workspace, f"/{issue['id']}/links"),
        headers=headers(workspace),
        json={"channel_name": workspace["channel"]["name"]},
    )
    seed_reply(db, workspace, "human", source="human:bob")
    seed_reply(db, workspace, "status", message_type="status")
    for event_id in ("human", "status", "missing"):
        assert (
            client.post(
                url, headers=headers(workspace), json={"source_event_id": event_id}
            ).status_code
            == 404
        )


def test_tasks_stay_passive_and_inherit_issue_context(client, workspace, db):
    issue = create(client, workspace)
    url = path(workspace, f"/{issue['id']}/tasks")
    with patch("app.routers.issues._emit_event_blocking") as emit:
        response = client.post(
            url,
            headers=headers(workspace),
            json={
                "title": "Add a welcome screen",
                "description": "Show the next action.",
            },
        )
        assert response.status_code == 200, response.text
        task = response.json()["data"]
        assert task["status"] == "backlog" and task["channel_name"] is None
        assert task["issue_id"] == issue["id"]
        emit.assert_not_called()
    assert detail(client, workspace, issue)["tasks"][0]["id"] == task["id"]
    assert "Improve onboarding" in _context_block(
        db, workspace["id"], db.get(KanbanTask, task["id"])
    )
    other = create(client, workspace, title="Another issue")
    assert (
        client.post(
            path(workspace, f"/{other['id']}/tasks"),
            headers=headers(workspace),
            json={"task_id": task["id"]},
        ).status_code
        == 409
    )
    standalone = client.post(
        "/v1/tasks",
        headers=headers(workspace),
        json={"network": workspace["id"], "title": "Standalone task"},
    ).json()["data"]
    assert (
        client.post(
            url, headers=headers(workspace), json={"task_id": standalone["id"]}
        ).json()["data"]["issue_id"]
        == issue["id"]
    )


def test_failed_thread_creation_leaves_issue_open(client, workspace):
    issue = create(client, workspace)
    with patch("app.routers.issues._emit_event_blocking", return_value=None):
        response = client.post(
            path(workspace, f"/{issue['id']}/threads"),
            headers=headers(workspace),
            json={"agents": ["agent-alpha"], "instruction": "Investigate"},
        )
    assert response.status_code == 502
    assert detail(client, workspace, issue)["status"] == "open"


def test_display_names_are_preserved(client, workspace):
    issue = create(client, workspace, source_name="Alice")
    assert issue["created_by"] == "human:alice"
    assert issue["created_by_name"] == "Alice"
    response = client.post(
        path(workspace, f"/{issue['id']}/comments"),
        headers=headers(workspace),
        json={
            "content": "Let's discuss",
            "source": "human:bob-id",
            "source_name": "Bob",
        },
    )
    assert response.json()["data"]["author_name"] == "Bob"
    assert response.json()["data"]["created_at"].endswith("+00:00")


def test_failed_kickoff_keeps_thread_link_for_recovery(client, workspace):
    from app.routers.issues import _emit_event_blocking

    issue = create(client, workspace)

    def emit(event, *args, **kwargs):
        if event.type == "workspace.message.posted":
            return None
        return _emit_event_blocking(event, *args, **kwargs)

    with patch("app.routers.issues._emit_event_blocking", side_effect=emit):
        response = client.post(
            path(workspace, f"/{issue['id']}/threads"),
            headers=headers(workspace),
            json={"agents": ["agent-alpha"], "instruction": "Investigate"},
        )
    assert response.status_code == 502
    result = detail(client, workspace, issue)
    assert len(result["threads"]) == 1
    assert result["status"] == "open"


# ── Permission model: private threads never show through an issue ─────────────

@pytest.fixture
def two_members(db, workspace, monkeypatch):
    from app import access
    from app.models import User, WorkspaceMembership

    mapping = {}
    for name in ("ann", "ben"):
        email = f"{name}@acme.test"
        user = User(email=email, display_name=name.capitalize())
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role="member"))
        mapping[name] = {"provider": "firebase", "email": email, "firebase_uid": email,
                         "apple_sub": None, "display_name": name.capitalize()}
    db.commit()
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: mapping.get(tok))
    return mapping


def _bearer(name):
    return {"Authorization": f"Bearer {name}"}


def test_private_linked_thread_is_hidden_from_non_participants(client, workspace, db, two_members):
    r = client.post("/v1/events", json={
        "type": "network.channel.create", "source": "human:ann", "target": "core",
        "network": workspace["id"],
        "payload": {"name": "ann-private", "title": "Ann private", "visibility": "private",
                    "sender_email": "ann@acme.test", "participants": ["agent-alpha"]},
    }, headers={"Authorization": "Bearer ann"})
    assert r.status_code == 200, r.text
    db.add(EventRecord(
        id="evt-private-reply", network_id=workspace["id"], type="workspace.message.posted",
        source="openagents:agent-alpha", target="channel/ann-private",
        payload={"content": "secret result", "message_type": "chat"}, timestamp=10**13,
    ))
    db.commit()

    issue = create(client, workspace)
    # Ben cannot link a private thread he is not in (it looks like it does not exist).
    r = client.post(path(workspace, f"/{issue['id']}/links"), headers=_bearer("ben"),
                    json={"channel_name": "ann-private"})
    assert r.status_code == 404
    # Ann can.
    r = client.post(path(workspace, f"/{issue['id']}/links"), headers=_bearer("ann"),
                    json={"channel_name": "ann-private"})
    assert r.status_code == 200, r.text

    ann_view = client.get(path(workspace, f"/{issue['id']}"), headers=_bearer("ann")).json()["data"]
    assert [t["channel_name"] for t in ann_view["threads"]] == ["ann-private"]
    assert ann_view["threads"][0]["latest_reply"]["content"] == "secret result"

    ben_view = client.get(path(workspace, f"/{issue['id']}"), headers=_bearer("ben")).json()["data"]
    assert ben_view["threads"] == []

    # Ben cannot share the private reply into the discussion either.
    r = client.post(path(workspace, f"/{issue['id']}/comments"), headers=_bearer("ben"),
                    json={"content": "", "source_event_id": "evt-private-reply", "source": "human:ben"})
    assert r.status_code == 404


def test_issue_started_thread_is_public(client, workspace, db):
    issue = create(client, workspace)
    with patch("app.routers.issues._emit_event_blocking") as emit:
        emit.return_value = None
        client.post(path(workspace, f"/{issue['id']}/threads"), headers=headers(workspace),
                    json={"agents": ["agent-alpha"], "instruction": "go", "source": "human:alice"})
    create_calls = [c for c in emit.call_args_list if c.args and c.args[0].type == "network.channel.create"]
    assert create_calls, "expected a channel create"
    assert create_calls[0].args[0].payload["visibility"] == "public"

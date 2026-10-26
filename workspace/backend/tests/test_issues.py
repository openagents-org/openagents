"""Only mentions of agents on an issue dispatch work."""

from types import SimpleNamespace
from unittest.mock import patch, AsyncMock

import pytest
from sqlalchemy import func, select

from app.models import Channel, EventRecord, WorkspaceMember


@pytest.fixture(autouse=True)
def cloud_dispatch():
    with patch("app.services.cloud_agent.invoke_cloud_agents", new_callable=AsyncMock) as invoke:
        yield invoke


def add_agents(client, ws, issue, names=("agent-alpha",)):
    response = client.post(path(ws, f"/{issue['id']}/participants"), headers=headers(ws),
                           json={"participants": [{"kind": "agent", "id": name} for name in names]})
    assert response.status_code == 200, response.text


def request_work(client, ws, issue, names=("agent-alpha",), instruction="Investigate", source="human:alice"):
    add_agents(client, ws, issue, names)
    return client.post(path(ws, f"/{issue['id']}/comments"), headers=headers(ws),
                       json={"content": " ".join("@" + n for n in names) + " " + instruction, "source": source})


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
    assert result["threads"] == []
    assert "tasks" not in result


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
            (f"/{issue['id']}/participants/remove", {"kind": "agent", "id": "agent-alpha"}),
            (f"/{issue['id']}/participants", {"participants": [{"kind": "agent", "id": "agent-alpha"}]}),
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
    response = request_work(client, workspace, issue, ("agent-alpha", "agent-beta"), "Investigate and propose options")
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


def test_unadded_agent_mentions_stay_passive_and_closed_issues_reject_work(client, workspace, db):
    issue = create(client, workspace)
    with patch("app.routers.issues._emit_event_blocking") as emit:
        response = client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace),
                               json={"content": "@agent-alpha investigate"})
        assert response.status_code == 200
        emit.assert_not_called()
    add_agents(client, workspace, issue)
    client.patch(path(workspace, f"/{issue['id']}"), headers=headers(workspace), json={"status": "closed"})
    assert request_work(client, workspace, issue).status_code == 409
    assert client.post(path(workspace, f"/{issue['id']}/threads"), headers=headers(workspace),
                       json={"agents": ["agent-alpha"], "instruction": "Legacy"}).status_code == 404


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


def test_issue_task_feature_is_removed_without_removing_workspace_tasks(client, workspace):
    issue = create(client, workspace)
    assert client.post(path(workspace, f"/{issue['id']}/tasks"), headers=headers(workspace),
                       json={"title": "Old issue task"}).status_code == 404
    assert client.post("/v1/tasks", headers=headers(workspace),
                       json={"network": workspace["id"], "title": "Standalone task"}).status_code == 200


def test_failed_thread_creation_leaves_issue_open(client, workspace):
    issue = create(client, workspace)
    with patch("app.routers.issues._emit_event_blocking", return_value=None):
        response = request_work(client, workspace, issue)
    assert response.status_code == 200
    assert response.json()["data"]["dispatch_error"]
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
        response = request_work(client, workspace, issue)
    assert response.status_code == 200
    assert response.json()["data"]["dispatch_error"]
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
    assert any(c["content"] == "secret result" and c["kind"] == "result" for c in ann_view["comments"])

    ben_view = client.get(path(workspace, f"/{issue['id']}"), headers=_bearer("ben")).json()["data"]
    assert ben_view["threads"] == []
    ann_list = client.get(path(workspace), headers=_bearer("ann")).json()["data"]["issues"]
    ben_list = client.get(path(workspace), headers=_bearer("ben")).json()["data"]["issues"]
    assert next(i for i in ann_list if i["id"] == issue["id"])["linked_channels"] == ["ann-private"]
    assert next(i for i in ben_list if i["id"] == issue["id"])["linked_channels"] == []
    assert not any(c["content"] == "secret result" for c in ben_view["comments"])

    before = len(ben_view['comments'])
    r = client.post(path(workspace, f"/{issue['id']}/comments"), headers=_bearer("ben"),
                    json={"content": "@agent-alpha continue", "reply_to_event_id": "evt-private-reply"})
    assert r.status_code == 404
    assert len(client.get(path(workspace, f"/{issue['id']}"), headers=_bearer("ben")).json()['data']['comments']) == before

    # Ben cannot share the private reply into the discussion either.
    r = client.post(path(workspace, f"/{issue['id']}/comments"), headers=_bearer("ben"),
                    json={"content": "", "source_event_id": "evt-private-reply", "source": "human:ben"})
    assert r.status_code == 404


def test_issue_started_thread_is_public(client, workspace, db):
    issue = create(client, workspace)
    with patch("app.routers.issues._emit_event_blocking") as emit:
        emit.return_value = None
        request_work(client, workspace, issue)
    create_calls = [c for c in emit.call_args_list if c.args and c.args[0].type == "network.channel.create"]
    assert create_calls, "expected a channel create"
    assert create_calls[0].args[0].payload["visibility"] == "public"


def test_add_issue_participants_persists_people_and_agents_without_starting_work(client, workspace, db, two_members):
    issue = create(client, workspace)
    url = path(workspace, f"/{issue['id']}/participants")
    selection = [{"kind": "human", "id": "ANN@acme.test"}, {"kind": "agent", "id": "agent-alpha"}]
    before = db.scalar(select(func.count()).select_from(Channel))
    with patch("app.routers.issues._emit_event_blocking") as emit:
        for _ in range(2):
            response = client.post(url, headers=_bearer("ben"), json={"participants": selection})
            assert response.status_code == 200, response.text
        emit.assert_not_called()
    saved = detail(client, workspace, issue)["participants"]
    assert {p["source"] for p in saved} == {"human:alice", "human:ann@acme.test", "openagents:agent-alpha"}
    assert next(p["name"] for p in saved if p["source"] == "human:ann@acme.test") == "Ann"
    assert len(saved) == 3
    assert db.scalar(select(func.count()).select_from(Channel)) == before
    assert detail(client, workspace, issue)["status"] == "open"


@pytest.mark.parametrize("person", [
    {"kind": "human", "id": "outsider@example.com"},
    {"kind": "agent", "id": "unregistered"},
    {"kind": "group", "id": "all"},
])
def test_invalid_issue_participants_are_atomic(client, workspace, two_members, person):
    issue = create(client, workspace)
    response = client.post(path(workspace, f"/{issue['id']}/participants"), headers=_bearer("ann"),
                           json={"participants": [{"kind": "human", "id": "ben@acme.test"}, person]})
    assert response.status_code == 422
    assert [p["source"] for p in detail(client, workspace, issue)["participants"]] == ["human:alice"]


def test_participants_cannot_be_added_to_another_workspace_issue(client, workspace):
    issue = create(client, workspace)
    data = client.post("/v1/workspaces", json={"name": "Other", "agent_name": "other-agent"}).json()["data"]
    other = {"id": data["workspaceId"], "token": data["token"]}
    response = client.post(path(other, f"/{issue['id']}/participants"), headers=headers(other),
                           json={"participants": [{"kind": "agent", "id": "agent-alpha"}]})
    assert response.status_code == 404


@pytest.mark.parametrize("content,source", [
    ("Ordinary discussion", "human:alice"),
    ("agent-alpha@example.com", "human:alice"),
    ("@agent-alpha-longer investigate", "human:alice"),
    ("`@agent-alpha` is a handle", "human:alice"),
    ("> @agent-alpha quoted request", "human:alice"),
    ("@agent-alpha investigate", "openagents:agent-beta"),
])
def test_non_direct_human_mentions_do_not_dispatch(client, workspace, content, source):
    issue = create(client, workspace)
    add_agents(client, workspace, issue)
    with patch("app.routers.issues._emit_event_blocking") as emit:
        response = client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace),
                               json={"content": content, "source": source})
        assert response.status_code == 200
        emit.assert_not_called()


def test_remove_inferred_agent_prevents_future_mentions_and_readd_restores(client, workspace, db):
    issue = create(client, workspace, channel_name=workspace["channel"]["name"])
    before = detail(client, workspace, issue)
    assert any(p["source"] == "openagents:agent-alpha" for p in before["participants"])
    url = path(workspace, f"/{issue['id']}/participants/remove")
    assert client.post(url, headers=headers(workspace), json={"kind": "agent", "id": "agent-alpha"}).status_code == 200
    after = detail(client, workspace, issue)
    assert all(p["source"] != "openagents:agent-alpha" for p in after["participants"])
    assert after["threads"] == before["threads"]
    with patch("app.routers.issues._emit_event_blocking") as emit:
        client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace), json={"content": "@agent-alpha wait"})
        emit.assert_not_called()
    response = request_work(client, workspace, issue)
    assert response.status_code == 200 and response.json()["data"].get("channel_name"), response.text
    assert any(p["source"] == "openagents:agent-alpha" for p in detail(client, workspace, issue)["participants"])


def test_mentioned_service_still_waits_for_reviewer(client, workspace, db, two_members, cloud_dispatch):
    from app.models import ApprovalRequest
    agent = db.get(WorkspaceMember, (workspace["id"], "agent-alpha"))
    agent.request_approver_email = "ann@acme.test"
    db.commit()
    issue = create(client, workspace)
    response = request_work(client, workspace, issue)
    assert response.status_code == 200 and not response.json()["data"].get("dispatch_error"), response.text
    approval = db.execute(select(ApprovalRequest).where(ApprovalRequest.kind == "service_request")).scalar_one()
    assert approval.status == "pending" and approval.assignee_email == "ann@acme.test"
    assert cloud_dispatch.call_args.args[1]["metadata"]["target_agents"] == ["__no_response__"]


def test_only_added_mentioned_agents_receive_request_even_when_context_mentions_others(client, workspace, db, cloud_dispatch):
    db.add(WorkspaceMember(workspace_id=workspace["id"], agent_name="agent-beta"))
    db.commit()
    issue = create(client, workspace, description="@agent-beta is mentioned in background context")
    add_agents(client, workspace, issue)
    response = client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace),
                           json={"content": "Please investigate @agent-alpha. Ask @agent-beta later."})
    assert response.status_code == 200 and response.json()["data"].get("channel_name"), response.text
    event = cloud_dispatch.call_args.args[1]
    assert event["metadata"]["target_agents"] == ["agent-alpha"]
    assert detail(client, workspace, issue)["threads"][0]["agents"] == ["agent-alpha"]


def test_assignment_handoffs_labels_and_paused(client, workspace, db, two_members):
    issue = create(client, workspace, source='human:ann@acme.test')
    url = path(workspace, f"/{issue['id']}")
    response = client.patch(url, headers=_bearer('ann'), json={'assignee':'human:ben@acme.test','labels':['Bug','Bug',' API '],'status':'paused'})
    assert response.status_code == 200, response.text
    assert response.json()['data']['labels'] == ['Bug','API']
    assert response.json()['data']['status'] == 'paused'
    agent = db.get(WorkspaceMember, (workspace['id'], 'agent-alpha'))
    agent.owner_email = 'ben@acme.test'
    db.commit()
    # Neither the creator nor the agent owner can assign an issue to an agent.
    for person in ('ann', 'ben'):
        assert client.patch(url, headers=_bearer(person), json={'assignee':'openagents:agent-alpha'}).status_code == 422
    # Preserve the ability to correct a legacy agent assignment.
    from app.models import Issue
    legacy = db.get(Issue, issue['id'])
    legacy.assignee = 'openagents:agent-alpha'
    db.commit()
    # The assigned agent's owner retains the ability to hand work to a human.
    assert client.patch(url, headers=_bearer('ben'), json={'assignee':'human:ann@acme.test'}).status_code == 200
    assert client.patch(url, headers=_bearer('ben'), json={'assignee':None}).status_code == 403
    assert client.patch(url, headers=_bearer('ann'), json={'labels':[' ']}).status_code == 422


def seed_issue_context(db, workspace, owner="human:ann@acme.test"):
    from app.models import KnowledgeEntry, FileRecord
    entry = KnowledgeEntry(workspace_id=workspace['id'], slug='issue-context', title='Support guide',
                           created_by=owner, owner=owner, visibility='private')
    file = FileRecord(workspace_id=workspace['id'], filename='evidence.txt', content_type='text/plain',
                      size=12, storage_key='test/evidence.txt', uploaded_by=owner, owner=owner, visibility='private')
    db.add_all([entry, file])
    db.commit()
    return entry, file


def test_create_human_assigned_issue_preserves_context(client, workspace, db, two_members):
    from app.models import KanbanTask
    agent = db.get(WorkspaceMember, (workspace['id'], 'agent-alpha'))
    agent.owner_email = 'ann@acme.test'
    entry, file = seed_issue_context(db, workspace)
    before = db.scalar(select(func.count()).select_from(Channel))
    with patch('app.routers.issues._emit_event_blocking') as emit:
        response = client.post(path(workspace), headers=_bearer('ann'), json={
            'title': 'Check evidence', 'source': 'human:spoof', 'assignee': 'human:ben@acme.test',
            'knowledge_ids': [entry.id, entry.id], 'file_ids': [file.id],
        })
        assert response.status_code == 200, response.text
        emit.assert_not_called()
    issue = response.json()['data']
    assert issue['created_by'] == 'human:ann@acme.test'
    assert issue['knowledge_ids'] == [entry.id]
    task = db.scalar(select(KanbanTask).where(KanbanTask.issue_id == issue['id']))
    assert task is None
    assert db.scalar(select(func.count()).select_from(Channel)) == before
    result = client.get(path(workspace, '/' + issue['id']), headers=_bearer('ben')).json()['data']
    assert result['attachments'][0]['filename'] == 'evidence.txt'
    assert result['knowledge'] == []  # Private knowledge is not shared by attaching its reference.
    db.refresh(file)
    assert file.visibility == 'public'


def test_create_human_assignment_does_not_prepare_agent_run(client, workspace, db, two_members):
    from app.models import KanbanTask
    response = client.post(path(workspace), headers=_bearer('ann'), json={
        'title': 'Human follow-up', 'source': 'human:ann@acme.test', 'assignee': 'human:ben@acme.test',
    })
    assert response.status_code == 200, response.text
    issue = response.json()['data']
    assert issue['assignee_name'] == 'Ben'
    assert db.scalar(select(KanbanTask).where(KanbanTask.issue_id == issue['id'])) is None


@pytest.mark.parametrize('field', ['knowledge_ids', 'file_ids'])
def test_issue_context_rejects_unreadable_or_missing_resources(client, workspace, db, two_members, field):
    from app.models import Issue
    entry, file = seed_issue_context(db, workspace)
    selected = entry.id if field == 'knowledge_ids' else file.id
    for ids in ([selected], ['missing']):
        response = client.post(path(workspace), headers=_bearer('ben'), json={
            'title': 'Cannot attach', 'source': 'human:ben@acme.test', field: ids,
        })
        assert response.status_code == 404, response.text
    assert db.scalar(select(func.count()).select_from(Issue)) == 0
    db.refresh(file)
    assert file.visibility == 'private'


@pytest.mark.parametrize('owner', ['ann@acme.test', 'ben@acme.test'])
def test_create_cannot_assign_an_agent(client, workspace, db, two_members, owner):
    agent = db.get(WorkspaceMember, (workspace['id'], 'agent-alpha'))
    agent.owner_email = owner
    db.commit()
    response = client.post(path(workspace), headers=_bearer('ann'), json={
        'title': 'Cannot assign', 'source': 'human:test@example.com', 'assignee': 'openagents:agent-alpha',
    })
    assert response.status_code == 422


def test_issue_mention_work_inherits_context(client, workspace, db):
    entry, file = seed_issue_context(db, workspace, owner='human:test@example.com')
    issue = create(client, workspace, knowledge_ids=[entry.id], file_ids=[file.id])
    response = request_work(client, workspace, issue)
    assert response.status_code == 200, response.text
    events = db.scalars(select(EventRecord).where(EventRecord.type == 'workspace.message.posted')).all()
    kickoff = next(e for e in events if 'Requested work:' in (e.payload or {}).get('content', ''))
    assert '@knowledge:issue-context' in kickoff.payload['content']
    assert kickoff.payload['attachments'][0]['file_id'] == file.id


def test_edit_attachment_does_not_require_access_to_unchanged_knowledge(client, workspace, db, two_members):
    entry, file = seed_issue_context(db, workspace)
    response = client.post(path(workspace), headers=_bearer('ann'), json={
        'title': 'Shared issue', 'source': 'human:ann@acme.test', 'knowledge_ids': [entry.id], 'file_ids': [file.id],
    })
    issue = response.json()['data']
    response = client.patch(path(workspace, '/' + issue['id']), headers=_bearer('ben'), json={
        'source': 'human:ben@acme.test', 'file_ids': [],
    })
    assert response.status_code == 200, response.text
    assert response.json()['data']['knowledge_ids'] == [entry.id]
    assert response.json()['data']['file_ids'] == []


def test_creator_sets_changes_and_clears_calendar_due_date(client, workspace, two_members):
    issue = create(client, workspace, source='human:ann@acme.test')
    assert issue['due_date'] is None
    url = path(workspace, f"/{issue['id']}")
    for value in ('2028-02-29', '2028-03-01', None):
        response = client.patch(url, headers=_bearer('ann'), json={'due_date': value, 'source': 'human:ben@acme.test'})
        assert response.status_code == 200, response.text
        assert response.json()['data']['due_date'] == value
        assert detail(client, workspace, issue)['due_date'] == value
    history = detail(client, workspace, issue)['comments']
    assert [(c['kind'], c['content'], c['author']) for c in history] == [
        ('due_date', '2028-02-29', 'human:ann@acme.test'),
        ('due_date', '2028-03-01', 'human:ann@acme.test'),
        ('due_date', '', 'human:ann@acme.test'),
    ]
    # Omission and a no-op clear preserve the value/history.
    client.patch(url, headers=_bearer('ann'), json={'title': 'Updated'})
    client.patch(url, headers=_bearer('ann'), json={'due_date': None})
    assert len(detail(client, workspace, issue)['comments']) == 3


@pytest.mark.parametrize('value', ['2027-01-01', None])
def test_assignee_and_spoofed_creator_cannot_edit_due_date(client, workspace, two_members, value):
    issue = create(client, workspace, source='human:ann@acme.test')
    url = path(workspace, f"/{issue['id']}")
    client.patch(url, headers=_bearer('ann'), json={'assignee': 'human:ben@acme.test', 'due_date': '2026-12-31'})
    for auth in (_bearer('ben'), headers(workspace)):
        response = client.patch(url, headers=auth, json={'due_date': value, 'source': 'human:ann@acme.test', 'title': 'Must not save'})
        assert response.status_code == 403, response.text
    result = detail(client, workspace, issue)
    assert result['due_date'] == '2026-12-31'
    assert result['title'] == issue['title']


@pytest.mark.parametrize('value', ['2026-02-29', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00Z', '', 1792895521, True])
def test_due_date_rejects_invalid_dates_and_timestamps(client, workspace, two_members, value):
    issue = create(client, workspace, source='human:ann@acme.test')
    response = client.patch(path(workspace, f"/{issue['id']}"), headers=_bearer('ann'), json={'due_date': value})
    assert response.status_code == 422, response.text
    assert detail(client, workspace, issue)['due_date'] is None


def test_due_date_visible_in_list_and_editable_on_closed_issues(client, workspace, two_members):
    issue = create(client, workspace, source='human:ann@acme.test')
    response = client.patch(path(workspace, f"/{issue['id']}"), headers=_bearer('ann'), json={'status': 'closed', 'due_date': '2026-01-01'})
    assert response.status_code == 200
    listing = client.get(path(workspace), headers=_bearer('ben')).json()['data']['issues']
    assert next(row for row in listing if row['id'] == issue['id'])['due_date'] == '2026-01-01'


def test_assigned_to_me_filters_before_pagination_and_search(client, workspace, two_members, db):
    from app.models import Issue
    owned = create(client, workspace, title='My follow-up')
    other = create(client, workspace, title='Other follow-up')
    create(client, workspace, title='Unassigned follow-up')
    db.get(Issue, owned['id']).assignee = 'human:ANN@acme.test'
    db.get(Issue, other['id']).assignee = 'human:ben@acme.test'
    db.commit()
    result = client.get(path(workspace) + '&assigned_to_me=true&limit=1&q=follow-up', headers=_bearer('ann'))
    assert result.status_code == 200
    assert [row['id'] for row in result.json()['data']['issues']] == [owned['id']]
    assert result.json()['data']['next_offset'] is None
    result = client.get(path(workspace) + '&assigned_to_me=true', headers=_bearer('ben'))
    assert [row['id'] for row in result.json()['data']['issues']] == [other['id']]
    assert client.get(path(workspace) + '&assigned_to_me=true', headers=headers(workspace)).status_code == 401


def test_label_suggestions_are_workspace_scoped_and_deduplicated(client, workspace, db):
    from app.models import Issue
    first = create(client, workspace)
    second = create(client, workspace)
    db.get(Issue, first['id']).labels = ['Bug', '暂停']
    db.get(Issue, second['id']).labels = ['Bug', 'API']
    db.commit()
    response = client.get(path(workspace, '/labels'), headers=headers(workspace))
    assert response.status_code == 200
    assert response.json()['data']['labels'] == ['API', 'Bug', '暂停']
    assert client.get(path(workspace, '/labels'), headers={'X-Workspace-Token': 'invalid'}).status_code == 403


def test_active_issues_exclude_paused_closed_before_pagination(client, workspace, two_members, db):
    from app.models import Issue
    by_status = {}
    for status in ('open', 'in_progress', 'paused', 'closed'):
        item = create(client, workspace, title=f'Follow-up {status}')
        record = db.get(Issue, item['id'])
        record.status = status
        record.assignee = 'human:ann@acme.test'
        db.commit()
        by_status[status] = item['id']
    query = path(workspace) + '&active_only=true&assigned_to_me=true&q=Follow-up&limit=1'
    first = client.get(query, headers=_bearer('ann')).json()['data']
    second = client.get(query + '&offset=1', headers=_bearer('ann')).json()['data']
    assert {first['issues'][0]['id'], second['issues'][0]['id']} == {by_status['open'], by_status['in_progress']}
    assert first['next_offset'] == 1 and second['next_offset'] is None
    for status in ('paused', 'closed'):
        response = client.get(path(workspace) + f'&status={status}', headers=headers(workspace))
        assert [row['id'] for row in response.json()['data']['issues']] == [by_status[status]]
    # Existing API callers can still explicitly enumerate every issue.
    assert len(client.get(path(workspace), headers=headers(workspace)).json()['data']['issues']) == 4


@pytest.mark.parametrize("instruction", ["", "Investigate the screenshots"])
def test_invite_then_mention_posts_discussion_and_dispatches_without_changing_assignee(client, workspace, db, instruction):
    from app.models import KanbanTask
    issue = create(client, workspace)
    add_agents(client, workspace, issue)
    add_agents(client, workspace, issue)  # safe retry after a comment failure
    content = "@agent-alpha" + (" " + instruction if instruction else "")
    response = client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace),
                           json={"content": content, "source": "human:alice"})
    assert response.status_code == 200, response.text
    assert response.json()["data"].get("channel_name")
    result = detail(client, workspace, issue)
    assert result["assignee"] is None
    assert result["status"] == "in_progress"
    assert len([p for p in result["participants"] if p["source"] == "openagents:agent-alpha"]) == 1
    assert any(c["content"] == content for c in result["comments"])
    assert result["threads"][0]["agents"] == ["agent-alpha"]
    assert db.scalar(select(KanbanTask).where(KanbanTask.issue_id == issue['id'])) is None


@pytest.mark.parametrize('shared', [False, True])
def test_new_agent_work_includes_previous_agent_reply_once(client, workspace, db, shared):
    import time
    issue = create(client, workspace)
    first = request_work(client, workspace, issue, instruction='Investigate the cause').json()['data']['channel_name']
    db.add_all([
        EventRecord(id='prior-finding', network_id=workspace['id'], type='workspace.message.posted',
                    source='openagents:agent-alpha', target=f'channel/{first}',
                    payload={'content': 'The discovery cache replaces the agent roster.', 'message_type': 'chat'}, timestamp=int(time.time() * 1000)),
        EventRecord(id='prior-thinking', network_id=workspace['id'], type='workspace.message.posted',
                    source='openagents:agent-alpha', target=f'channel/{first}',
                    payload={'content': 'INTERNAL_THINKING', 'message_type': 'thinking'}, timestamp=int(time.time() * 1000)),
        EventRecord(id='unlinked-finding', network_id=workspace['id'], type='workspace.message.posted',
                    source='openagents:agent-alpha', target='channel/unlinked',
                    payload={'content': 'UNRELATED_DISCUSSION', 'message_type': 'chat'}, timestamp=int(time.time() * 1000)),
    ])
    db.commit()
    if shared:
        assert client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace),
                           json={'source_event_id': 'prior-finding'}).status_code == 200
    db.add(WorkspaceMember(workspace_id=workspace['id'], agent_name='agent-beta'))
    db.commit()
    followup = request_work(client, workspace, issue, names=('agent-beta',), instruction='Fix it using those findings')
    assert followup.status_code == 200, followup.text
    channel = followup.json()['data']['channel_name']
    kickoff = db.scalars(select(EventRecord).where(EventRecord.target == f'channel/{channel}', EventRecord.type == 'workspace.message.posted', EventRecord.source == 'human:alice')).first()
    content = kickoff.payload['content']
    assert content.count('The discovery cache replaces the agent roster.') == 1
    assert 'openagents:agent-alpha' in content
    assert 'Investigate the cause' in content
    assert 'Fix it using those findings' in content
    assert 'INTERNAL_THINKING' not in content
    assert 'UNRELATED_DISCUSSION' not in content


def test_followup_does_not_copy_private_linked_replies_into_public_work(client, workspace, db):
    import time
    channel = db.scalar(select(Channel).where(Channel.workspace_id == workspace['id'], Channel.name == workspace['channel']['name']))
    channel.visibility = 'private'
    db.commit()
    issue = create(client, workspace, channel_name=channel.name)
    seed_reply(db, workspace, 'private-result', timestamp=int(time.time() * 1000))
    # A new agent starts a public thread, so private results must not be copied.
    assert any(c['content'] == 'Here are my findings.' for c in detail(client, workspace, issue)['comments'])
    db.add(WorkspaceMember(workspace_id=workspace['id'], agent_name='agent-beta'))
    db.commit()
    result = request_work(client, workspace, issue, names=('agent-beta',)).json()['data']
    kickoff = db.scalars(select(EventRecord).where(EventRecord.target == 'channel/' + result['channel_name'], EventRecord.type == 'workspace.message.posted')).first()
    assert 'Here are my findings.' not in kickoff.payload['content']


def test_work_request_includes_selected_knowledge_without_changing_issue_context(client, workspace, db, cloud_dispatch):
    from app.models import KnowledgeEntry
    entry = KnowledgeEntry(workspace_id=workspace['id'], slug='runtime-guide', title='Runtime guide @agent-beta',
                           created_by='human:alice', visibility='public')
    db.add(entry)
    db.commit()
    issue = create(client, workspace)
    add_agents(client, workspace, issue)
    response = client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace),
                           json={'source': 'human:alice', 'content': '@agent-alpha', 'knowledge_ids': [entry.id, entry.id]})
    assert response.status_code == 200, response.text
    comment = response.json()['data']
    assert comment['content'].count('@knowledge:runtime-guide') == 1
    event = cloud_dispatch.call_args.args[1]
    assert '@knowledge:runtime-guide' in event['payload']['content']
    assert event['metadata']['target_agents'] == ['agent-alpha']
    assert detail(client, workspace, issue)['knowledge_ids'] == []
    db.refresh(entry)
    assert entry.visibility == 'public'


@pytest.mark.parametrize('selection', ['private', 'missing', 'deleted', 'foreign'])
def test_request_context_checks_access_before_saving_or_dispatching(client, workspace, db, two_members, selection):
    from app.models import IssueComment
    entry, _ = seed_issue_context(db, workspace)
    issue = create(client, workspace)
    add_agents(client, workspace, issue)
    selected = entry.id
    if selection == 'missing': selected = 'missing-knowledge'
    if selection == 'deleted': entry.status = 'deleted'
    if selection == 'foreign':
        other = client.post('/v1/workspaces', json={'name': 'Other workspace'}).json()['data']
        entry.workspace_id = other['workspaceId']
    db.commit()
    with patch('app.routers.issues._emit_event_blocking') as emit:
        response = client.post(path(workspace, f"/{issue['id']}/comments"), headers=_bearer('ben'),
            json={'content': '@agent-alpha investigate', 'knowledge_ids': [selected]})
        assert response.status_code == 404, response.text
        emit.assert_not_called()
    assert db.scalar(select(func.count()).select_from(IssueComment).where(IssueComment.issue_id == issue['id'])) == 0


def test_direct_mentions_continue_latest_thread_and_reply_targets_exact_thread(client, workspace, db, cloud_dispatch):
    from app.models import ChannelMember, IssueThread
    issue = create(client, workspace)
    first = request_work(client, workspace, issue).json()['data']['channel_name']
    other = Channel(workspace_id=workspace['id'], name='newer-work', last_event_at=10**13)
    db.add(other)
    db.flush()
    db.add_all([ChannelMember(channel_id=other.id, agent_name='agent-alpha'),
                IssueThread(issue_id=issue['id'], channel_id=other.id),
                EventRecord(id='original-answer', network_id=workspace['id'], type='workspace.message.posted',
                    source='openagents:agent-alpha', target=f'channel/{first}',
                    payload={'content': 'Original answer', 'message_type': 'chat'}, timestamp=10)])
    db.commit()
    before = db.scalar(select(func.count()).select_from(Channel))
    result = request_work(client, workspace, issue, instruction='Follow up').json()['data']
    assert result['channel_name'] == 'newer-work'
    assert cloud_dispatch.call_args.args[1]['payload']['content'] == '@agent-alpha Follow up'
    assert cloud_dispatch.call_args.args[1]['metadata']['target_agents'] == ['agent-alpha']
    answer = next(c for c in detail(client, workspace, issue)['comments'] if c['id'] == 'original-answer')
    assert answer['reply_channel_name'] == first
    response = client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace),
        json={'content': '@agent-alpha Fix this one', 'source': 'human:alice', 'reply_to_event_id': 'original-answer'})
    assert response.status_code == 200, response.text
    assert response.json()['data']['channel_name'] == first
    assert cloud_dispatch.call_args.args[1]['target'] == f'channel/{first}'
    assert cloud_dispatch.call_args.args[1]['payload']['content'] == '@agent-alpha Fix this one'
    assert db.scalar(select(func.count()).select_from(Channel)) == before


@pytest.mark.parametrize('invalid', ['missing', 'unlinked', 'thinking', 'archived', 'other-agent'])
def test_invalid_reply_does_not_save_comment_or_dispatch(client, workspace, db, cloud_dispatch, invalid):
    issue = create(client, workspace, channel_name=workspace['channel']['name'])
    seed_reply(db, workspace, 'answer', message_type='thinking' if invalid == 'thinking' else 'chat')
    if invalid == 'unlinked':
        from app.models import IssueThread
        db.query(IssueThread).filter(IssueThread.issue_id == issue['id']).delete()
    if invalid == 'archived':
        db.scalar(select(Channel).where(Channel.workspace_id == workspace['id'], Channel.name == workspace['channel']['name'])).status = 'archived'
    if invalid == 'other-agent':
        db.add(WorkspaceMember(workspace_id=workspace['id'], agent_name='agent-beta'))
        db.commit()
        add_agents(client, workspace, issue, ('agent-beta',))
    db.commit()
    before = len(detail(client, workspace, issue)['comments'])
    cloud_dispatch.reset_mock()
    response = client.post(path(workspace, f"/{issue['id']}/comments"), headers=headers(workspace),
        json={'content': '@agent-beta hi' if invalid == 'other-agent' else '@agent-alpha hi',
              'reply_to_event_id': 'missing' if invalid == 'missing' else 'answer'})
    assert response.status_code in (404, 409, 422), response.text
    assert len(detail(client, workspace, issue)['comments']) == before
    cloud_dispatch.assert_not_called()

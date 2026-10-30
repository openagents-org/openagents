# -*- coding: utf-8 -*-
"""Tests for the workflow template CRUD (/v1/workflows)."""


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _steps():
    return [
        {"name": "Draft", "instruction": "Write a draft", "assignee": {"kind": "agent", "agent": "agent-alpha"}},
        {"name": "Review", "instruction": "Review the draft", "assignee": {"kind": "human", "human": "alice"}},
    ]


def _create(client, workspace, **overrides):
    body = {"network": workspace["id"], "name": "Draft & review", "steps": _steps()}
    body.update(overrides)
    return client.post("/v1/workflows", json=body, headers=_headers(workspace))


class TestWorkflowCrud:
    def test_create_assigns_step_ids_and_defaults(self, client, workspace):
        resp = _create(client, workspace)
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["name"] == "Draft & review"
        assert data["max_iterations"] == 5
        assert len(data["steps"]) == 2
        assert all(s["id"] for s in data["steps"])  # ids auto-assigned
        assert data["steps"][0]["assignee"]["agent"] == "agent-alpha"
        assert data["steps"][1]["assignee"]["kind"] == "human"

    def test_create_requires_name(self, client, workspace):
        resp = _create(client, workspace, name="  ")
        assert resp.json().get("code") != 0

    def test_create_requires_a_step(self, client, workspace):
        resp = _create(client, workspace, steps=[])
        assert resp.json().get("code") != 0

    def test_step_requires_instruction(self, client, workspace):
        resp = _create(client, workspace, steps=[{"assignee": {"kind": "agent", "agent": "agent-alpha"}}])
        assert resp.json().get("code") != 0

    def test_agent_step_requires_agent(self, client, workspace):
        resp = _create(client, workspace, steps=[{"instruction": "do", "assignee": {"kind": "agent"}}])
        assert resp.json().get("code") != 0

    def test_gate_target_must_exist(self, client, workspace):
        steps = _steps()
        steps[1]["gate"] = {"condition": "not good enough", "target": "does-not-exist"}
        resp = _create(client, workspace, steps=steps)
        assert resp.json().get("code") != 0

    def test_gate_loop_back_by_step_id(self, client, workspace):
        # First create to get real step ids, then set a gate looping step 2 -> step 1.
        created = _create(client, workspace).json()["data"]
        first_id = created["steps"][0]["id"]
        steps = created["steps"]
        steps[1]["gate"] = {"condition": "the draft still needs work", "target": first_id}
        resp = client.patch(
            f"/v1/workflows/{created['id']}",
            json={"network": workspace["id"], "steps": steps},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["steps"][1]["gate"]["target"] == first_id

    def test_step_knowledge_id_validated(self, client, workspace, db):
        from app.models import KnowledgeEntry
        entry = KnowledgeEntry(
            workspace_id=workspace["id"], slug="api-docs", title="API docs",
            created_by="human:user", status="active",
        )
        db.add(entry)
        db.commit()

        steps = _steps()
        steps[0]["knowledge_id"] = entry.id      # valid → kept
        steps[1]["knowledge_id"] = "bogus-id"    # invalid → dropped
        resp = _create(client, workspace, steps=steps)
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]["steps"]
        assert data[0]["knowledge_id"] == entry.id
        assert "knowledge_id" not in data[1]

    def test_max_iterations_clamped(self, client, workspace):
        assert _create(client, workspace, max_iterations=0).json()["data"]["max_iterations"] == 5
        assert _create(client, workspace, max_iterations=999).json()["data"]["max_iterations"] == 50

    def test_list_get_delete(self, client, workspace):
        wid = _create(client, workspace).json()["data"]["id"]
        lst = client.get(f"/v1/workflows?network={workspace['id']}", headers=_headers(workspace))
        assert wid in {w["id"] for w in lst.json()["data"]["workflows"]}
        got = client.get(f"/v1/workflows/{wid}?network={workspace['id']}", headers=_headers(workspace))
        assert got.status_code == 200 and got.json()["data"]["id"] == wid
        dele = client.delete(f"/v1/workflows/{wid}?network={workspace['id']}", headers=_headers(workspace))
        assert dele.status_code == 200
        gone = client.get(f"/v1/workflows/{wid}?network={workspace['id']}", headers=_headers(workspace))
        assert gone.json().get("code") != 0

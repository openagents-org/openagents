# -*- coding: utf-8 -*-
"""
Tests for the knowledge base endpoints.
"""

import pytest


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


class TestCreateKnowledge:
    def test_create_entry(self, client, workspace):
        resp = client.post(
            "/v1/knowledge",
            json={
                "network": workspace["id"],
                "title": "API Design Patterns",
                "content": "# API Design Patterns\n\nUse REST.",
                "description": "Common patterns",
                "source": "human:user",
            },
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["title"] == "API Design Patterns"
        assert data["slug"] == "api-design-patterns"
        assert data["description"] == "Common patterns"
        assert data["content"] == "# API Design Patterns\n\nUse REST."
        assert data["content_size"] > 0

    def test_slug_deduplication(self, client, workspace):
        for _ in range(2):
            client.post(
                "/v1/knowledge",
                json={"network": workspace["id"], "title": "Dupe", "content": "x"},
                headers=_headers(workspace),
            )
        resp = client.get(
            f"/v1/knowledge?network={workspace['id']}",
            headers=_headers(workspace),
        )
        slugs = [e["slug"] for e in resp.json()["data"]["entries"]]
        assert len(set(slugs)) == 2
        assert "dupe" in slugs
        assert "dupe-2" in slugs


class TestListKnowledge:
    def test_list_empty(self, client, workspace):
        resp = client.get(
            f"/v1/knowledge?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["entries"] == []
        assert data["total"] == 0

    def test_list_returns_entries(self, client, workspace):
        client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Entry A", "content": "a"},
            headers=_headers(workspace),
        )
        resp = client.get(
            f"/v1/knowledge?network={workspace['id']}",
            headers=_headers(workspace),
        )
        data = resp.json()["data"]
        assert data["total"] == 1
        assert data["entries"][0]["title"] == "Entry A"


class TestGetKnowledge:
    def test_get_by_id(self, client, workspace):
        create = client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Test", "content": "hello"},
            headers=_headers(workspace),
        )
        entry_id = create.json()["data"]["id"]
        resp = client.get(
            f"/v1/knowledge/{entry_id}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["content"] == "hello"

    def test_get_by_slug(self, client, workspace):
        client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Slug Test", "content": "by slug"},
            headers=_headers(workspace),
        )
        resp = client.get(
            f"/v1/knowledge/by-slug/slug-test?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["content"] == "by slug"

    def test_get_not_found(self, client, workspace):
        resp = client.get(
            "/v1/knowledge/nonexistent-id",
            headers=_headers(workspace),
        )
        assert resp.status_code == 404


class TestUpdateKnowledge:
    def test_update_content(self, client, workspace):
        create = client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Original", "content": "v1"},
            headers=_headers(workspace),
        )
        entry_id = create.json()["data"]["id"]
        resp = client.put(
            f"/v1/knowledge/{entry_id}",
            json={"network": workspace["id"], "content": "v2"},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["content"] == "v2"

    def test_update_title_changes_slug(self, client, workspace):
        create = client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Old Title", "content": "x"},
            headers=_headers(workspace),
        )
        entry_id = create.json()["data"]["id"]
        resp = client.put(
            f"/v1/knowledge/{entry_id}",
            json={"network": workspace["id"], "title": "New Title"},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["slug"] == "new-title"


class TestDeleteKnowledge:
    def test_soft_delete(self, client, workspace):
        create = client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "To Delete", "content": "bye"},
            headers=_headers(workspace),
        )
        entry_id = create.json()["data"]["id"]
        resp = client.delete(
            f"/v1/knowledge/{entry_id}?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "deleted"

        # Should not appear in list
        list_resp = client.get(
            f"/v1/knowledge?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert list_resp.json()["data"]["total"] == 0


@pytest.fixture
def person(db, workspace, monkeypatch):
    """A signed-in workspace admin, sent the way the web app sends it."""
    import app.access as access
    from app.models import User, WorkspaceMembership
    user = User(email="adam@acme.test", display_name="Adam")
    db.add(user)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role="admin"))
    db.commit()
    claims = {"provider": "firebase", "email": "adam@acme.test", "firebase_uid": "adam@acme.test",
              "apple_sub": None, "display_name": "Adam"}
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: claims if tok == "adam" else None)
    return {**_headers(workspace), "Authorization": "Bearer adam"}


class TestDecisionLogsDisabled:
    """Connectors before 0.2.209 still tell agents to keep a per-channel
    "Decisions for channel <name>" entry; the server refuses those writes
    from anyone who is not a person."""

    def _create(self, client, workspace, title, source=None, headers=None, content="- decided", visibility=None):
        body = {"network": workspace["id"], "title": title, "content": content}
        if source is not None:
            body["source"] = source
        if visibility is not None:
            body["visibility"] = visibility
        return client.post("/v1/knowledge", json=body, headers=headers or _headers(workspace))

    def _titles(self, client, workspace):
        resp = client.get(f"/v1/knowledge?network={workspace['id']}", headers=_headers(workspace))
        return [e["title"] for e in resp.json()["data"]["entries"]]

    def test_agent_cannot_create_decision_log(self, client, workspace):
        resp = self._create(client, workspace, "Decisions for channel general", "openagents:agent-alpha")
        assert resp.status_code == 403
        assert "Decision logs are turned off" in resp.json()["message"]
        assert self._titles(client, workspace) == []

    def test_token_only_call_without_source_is_refused(self, client, workspace):
        # What an older agent's curl call looks like when it leaves out "source":
        # the field then defaults to "human:user", so the token is what counts.
        resp = self._create(client, workspace, "Decisions for channel general")
        assert resp.status_code == 403
        resp = self._create(client, workspace, "Decisions for channel general", "human:user")
        assert resp.status_code == 403
        assert self._titles(client, workspace) == []

    def test_title_match_ignores_case_and_padding(self, client, workspace):
        resp = self._create(client, workspace, "  decisions FOR channel thread-1", "openagents:agent-alpha")
        assert resp.status_code == 403

    def test_agent_identified_by_header_is_refused(self, client, workspace):
        resp = self._create(client, workspace, "Decisions for channel general",
                            headers={**_headers(workspace), "X-Agent-Name": "agent-alpha"})
        assert resp.status_code == 403

    def test_agent_can_still_create_other_entries(self, client, workspace):
        for title in ("Glossary for channel general", "Decisions we made in Q3"):
            resp = self._create(client, workspace, title, "openagents:agent-alpha")
            assert resp.status_code == 200, resp.text

    def test_signed_in_person_can_still_create_one(self, client, workspace, person):
        resp = self._create(client, workspace, "Decisions for channel general", "human:user", headers=person)
        assert resp.status_code == 200, resp.text

    def test_agent_cannot_edit_existing_decision_log(self, client, workspace, person):
        # Public, like the logs agents created: otherwise the agent has no access anyway.
        entry_id = self._create(client, workspace, "Decisions for channel general", "human:user",
                                headers=person, visibility="public").json()["data"]["id"]
        for source in ("openagents:agent-alpha", None):
            body = {"network": workspace["id"], "content": "- new"}
            if source:
                body["source"] = source
            resp = client.put(f"/v1/knowledge/{entry_id}", json=body, headers=_headers(workspace))
            assert resp.status_code == 403
            assert "Decision logs are turned off" in resp.json()["message"]
        got = client.get(f"/v1/knowledge/{entry_id}", headers=_headers(workspace)).json()["data"]
        assert got["content"] == "- decided"

    def test_agent_cannot_rename_an_entry_into_a_decision_log(self, client, workspace):
        entry_id = self._create(client, workspace, "Notes", "openagents:agent-alpha").json()["data"]["id"]
        resp = client.put(
            f"/v1/knowledge/{entry_id}",
            json={"network": workspace["id"], "title": "Decisions for channel general",
                  "source": "openagents:agent-alpha"},
            headers=_headers(workspace),
        )
        assert resp.status_code == 403
        assert self._titles(client, workspace) == ["Notes"]

    def test_signed_in_person_can_still_edit_and_anyone_can_delete(self, client, workspace, person):
        entry_id = self._create(client, workspace, "Decisions for channel general", "human:user",
                                headers=person, visibility="public").json()["data"]["id"]
        resp = client.put(
            f"/v1/knowledge/{entry_id}",
            json={"network": workspace["id"], "content": "- edited", "source": "human:user"},
            headers=person,
        )
        assert resp.status_code == 200, resp.text
        # Agents may clean these pages up: deleting is not refused.
        resp = client.delete(f"/v1/knowledge/{entry_id}?network={workspace['id']}", headers=_headers(workspace))
        assert resp.status_code == 200, resp.text

# -*- coding: utf-8 -*-
"""Public "anyone with the link" file links: who may create and revoke them,
and what the unauthenticated routes serve."""

from sqlalchemy import delete

import app.routers.file_links as file_links
from app.models import FileShareLink, User, WorkspaceMembership
from tests.test_visibility import _bearer, _tok, no_push, people  # noqa: F401


def _upload(client, ws, headers, name="mine.txt", data=b"hello", content_type="text/plain"):
    r = client.post("/v1/files", files={"file": (name, data, content_type)},
                    data={"network": ws["id"]}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["data"]["id"]


def _link(client, ws, fid, headers):
    return client.get(f"/v1/files/{fid}/public-link?network={ws['id']}", headers=headers)


def _create(client, ws, fid, headers):
    return client.post(f"/v1/files/{fid}/public-link", json={"network": ws["id"]}, headers=headers)


def _revoke(client, ws, fid, headers):
    return client.delete(f"/v1/files/{fid}/public-link?network={ws['id']}", headers=headers)


def test_owner_creates_a_link_anyone_can_open(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "报告.md", "# hi".encode(), "text/markdown")

    assert _link(client, workspace, fid, mia).json()["data"] == {"link": None, "can_manage": True}
    r = _create(client, workspace, fid, mia)
    assert r.status_code == 200, r.text
    token = r.json()["data"]["link"]["token"]
    # idempotent: the same live link comes back
    assert _create(client, workspace, fid, mia).json()["data"]["link"]["token"] == token

    info = client.get(f"/v1/public/files/{token}")
    assert info.status_code == 200
    assert info.json()["data"]["filename"].endswith("报告.md")
    assert "/" not in info.json()["data"]["filename"], "no folder path leaks out"

    content = client.get(f"/v1/public/files/{token}/content")
    assert content.status_code == 200
    assert content.content == "# hi".encode()
    assert content.headers["content-disposition"].startswith("attachment")
    assert content.headers["x-content-type-options"] == "nosniff"
    # The token is in the page URL: nothing may forward it as a Referer.
    assert content.headers["referrer-policy"] == "no-referrer"
    assert info.headers["referrer-policy"] == "no-referrer"
    # "Shared on" is the link's date, not the upload's.
    assert info.json()["data"]["shared_at"]


def test_only_managers_create_revoke_or_see_the_token(client, workspace, people):
    mia, vic = _bearer("mia", workspace), _bearer("vic", workspace)
    fid = _upload(client, workspace, mia)
    # vic can't even read the private file
    assert _create(client, workspace, fid, vic).status_code == 403
    token = _create(client, workspace, fid, mia).json()["data"]["link"]["token"]

    # once vic can read it, they learn a link exists but not its token
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    seen = _link(client, workspace, fid, vic).json()["data"]
    assert seen["can_manage"] is False and seen["link"]["active"] is True and "token" not in seen["link"]
    assert _create(client, workspace, fid, vic).status_code == 403
    assert _revoke(client, workspace, fid, vic).status_code == 403

    assert _revoke(client, workspace, fid, mia).status_code == 200
    assert client.get(f"/v1/public/files/{token}").status_code == 404
    assert client.get(f"/v1/public/files/{token}/content").status_code == 404
    # sharing again mints a new token; the old one stays dead
    fresh = _create(client, workspace, fid, mia).json()["data"]["link"]["token"]
    assert fresh != token
    assert client.get(f"/v1/public/files/{token}").status_code == 404
    assert client.get(f"/v1/public/files/{fresh}").status_code == 200


def test_trashed_file_link_stops_working(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    token = _create(client, workspace, fid, mia).json()["data"]["link"]["token"]
    assert client.delete(f"/v1/files/{fid}?network={workspace['id']}", headers=mia).status_code == 200
    assert client.get(f"/v1/public/files/{token}").status_code == 404


def test_unknown_token_is_404(client):
    for url in ("/v1/public/files/nope", "/v1/public/files/nope/content"):
        r = client.get(url)
        assert r.status_code == 404
        assert r.headers["referrer-policy"] == "no-referrer"


def test_creator_role_lookup_matches_the_full_member_list(db, workspace, people):
    from app.models import Workspace
    from app.services.access_model import workspace_human_role, workspace_human_roles
    ws = db.get(Workspace, workspace["id"])
    roles = workspace_human_roles(db, ws)
    assert roles
    for email, role in roles.items():
        assert workspace_human_role(db, ws, email) == role
        assert workspace_human_role(db, ws, email.upper()) == role
    assert workspace_human_role(db, ws, "nobody@example.com") is None
    assert workspace_human_role(db, ws, None) is None


def test_agents_and_workspace_tokens_cannot_create_links(client, workspace, people):
    # A prompt-injected agent must not be able to publish a private file.
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    assert _create(client, workspace, fid, _tok(workspace)).status_code == 403
    agent = {**_tok(workspace), "X-Agent-Name": "deploy-bot"}
    assert _create(client, workspace, fid, agent).status_code == 403
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None


def test_restoring_from_trash_does_not_revive_the_link(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    token = _create(client, workspace, fid, mia).json()["data"]["link"]["token"]
    trashed = client.post("/v1/files/trash", json={"network": workspace["id"], "file_ids": [fid]}, headers=mia)
    assert trashed.status_code == 200, trashed.text
    trash_id = trashed.json()["data"]["entries"][0]["trash_id"]
    restored = client.post("/v1/files/trash/restore", json={"network": workspace["id"], "trash_ids": [trash_id]}, headers=mia)
    assert restored.status_code == 200, restored.text
    assert client.get(f"/v1/files/{fid}", headers=mia).status_code == 200
    assert client.get(f"/v1/public/files/{token}").status_code == 404
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None


def test_a_racing_second_create_returns_the_first_link(client, db, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    first = _create(client, workspace, fid, mia).json()["data"]["link"]["token"]
    # The second request read "no live link" before the first committed.
    real = file_links._live_link
    calls = {"n": 0}

    def stale_then_real(session, file_id):
        calls["n"] += 1
        return None if calls["n"] == 1 else real(session, file_id)

    monkeypatch.setattr(file_links, "_live_link", stale_then_real)
    second = _create(client, workspace, fid, mia)
    assert second.status_code == 200, second.text
    assert second.json()["data"]["link"]["token"] == first
    assert db.query(FileShareLink).filter(FileShareLink.file_id == fid, FileShareLink.revoked_at.is_(None)).count() == 1


def test_link_dies_when_its_creator_leaves_the_workspace(client, db, workspace, people):
    adam, mia = _bearer("adam", workspace), _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    token = _create(client, workspace, fid, adam).json()["data"]["link"]["token"]
    assert client.get(f"/v1/public/files/{token}").status_code == 200
    adam_id = db.query(User).filter(User.email == "adam@acme.test").one().id
    db.execute(delete(WorkspaceMembership).where(WorkspaceMembership.user_id == adam_id))
    db.commit()
    assert client.get(f"/v1/public/files/{token}").status_code == 404
    assert client.get(f"/v1/public/files/{token}/content").status_code == 404


def test_storage_errors_read_as_not_found(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    token = _create(client, workspace, fid, mia).json()["data"]["link"]["token"]

    class MissingObject:
        def read(self, key):
            raise RuntimeError("NoSuchKey")  # S3's own error type, not FileNotFoundError

    monkeypatch.setattr(file_links, "get_file_store", lambda: MissingObject())
    assert client.get(f"/v1/public/files/{token}/content").status_code == 404

# -*- coding: utf-8 -*-
"""Public "anyone with the link" snapshot links to thread artifacts: who may
create, refresh, revoke and approve them, and what the unauthenticated routes
serve."""

import base64
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete

import app.routers.public_shares as public_routes
from app.config import config
from app.models import ApprovalRequest, PublicShare, User, WorkspaceMembership
from tests.test_visibility import _bearer, _claims, _tok, no_push, people  # noqa: F401


def _upload(client, ws, headers, name="mine.txt", data=b"hello", content_type="text/plain"):
    r = client.post("/v1/files", files={"file": (name, data, content_type)},
                    data={"network": ws["id"]}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["data"]["id"]


def _link(client, ws, fid, headers, kind="file"):
    return client.get(f"/v1/public-shares?network={ws['id']}&kind={kind}&id={fid}", headers=headers)


def _create(client, ws, fid, headers, kind="file", expires_at=None):
    body = {"network": ws["id"], "kind": kind, "id": fid}
    if expires_at:
        body["expires_at"] = expires_at
    return client.post("/v1/public-shares", json=body, headers=headers)


def _revoke(client, ws, fid, headers, kind="file"):
    return client.delete(f"/v1/public-shares?network={ws['id']}&kind={kind}&id={fid}", headers=headers)


def _token(response):
    assert response.status_code == 200, response.text
    return response.json()["data"]["link"]["token"]


def test_owner_creates_a_link_anyone_can_open(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "报告.md", "# hi".encode(), "text/markdown")

    assert _link(client, workspace, fid, mia).json()["data"] == {"link": None, "can_manage": True}
    created = _create(client, workspace, fid, mia).json()["data"]["link"]
    token = created["token"]
    assert created["url"].endswith(f"/share/artifact/{token}")
    assert created["expires_at"] is None, "no expiry unless one is chosen"

    info = client.get(f"/v1/public/shares/{token}")
    assert info.status_code == 200
    assert info.json()["data"]["title"].endswith("报告.md")
    assert "/" not in info.json()["data"]["title"], "no folder path leaks out"
    assert info.json()["data"]["shared_at"]

    content = client.get(f"/v1/public/shares/{token}/content")
    assert content.status_code == 200
    assert content.content == "# hi".encode()
    assert content.headers["content-disposition"].startswith("attachment")
    assert content.headers["x-content-type-options"] == "nosniff"
    # The token is in the page URL: nothing may forward it as a Referer.
    assert content.headers["referrer-policy"] == "no-referrer"
    assert info.headers["referrer-policy"] == "no-referrer"


def test_the_link_serves_a_snapshot_until_it_is_refreshed(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "notes.md", b"# v1", "text/markdown")
    token = _token(_create(client, workspace, fid, mia))

    edited = client.put(f"/v1/files/{fid}/content", json={"network": workspace["id"], "content": "# v2"}, headers=mia)
    assert edited.status_code == 200, edited.text
    # An edit (an agent rewriting the file) does not reach the public.
    assert client.get(f"/v1/public/shares/{token}/content").content == b"# v1"

    # Sharing again refreshes the copy and keeps the same link.
    assert _token(_create(client, workspace, fid, mia)) == token
    assert client.get(f"/v1/public/shares/{token}/content").content == b"# v2"


def test_only_managers_create_revoke_or_see_the_token(client, workspace, people):
    mia, vic = _bearer("mia", workspace), _bearer("vic", workspace)
    fid = _upload(client, workspace, mia)
    # vic can't even read the private file
    assert _create(client, workspace, fid, vic).status_code == 403
    token = _token(_create(client, workspace, fid, mia))

    # once vic can read it, they learn a link exists but not its token
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    seen = _link(client, workspace, fid, vic).json()["data"]
    assert seen["can_manage"] is False and seen["link"]["active"] is True
    assert "token" not in seen["link"] and "url" not in seen["link"]
    assert _create(client, workspace, fid, vic).status_code == 403
    assert _revoke(client, workspace, fid, vic).status_code == 403

    assert _revoke(client, workspace, fid, mia).status_code == 200
    assert client.get(f"/v1/public/shares/{token}").status_code == 404
    assert client.get(f"/v1/public/shares/{token}/content").status_code == 404
    # sharing again mints a new token; the old one stays dead
    fresh = _token(_create(client, workspace, fid, mia))
    assert fresh != token
    assert client.get(f"/v1/public/shares/{token}").status_code == 404
    assert client.get(f"/v1/public/shares/{fresh}").status_code == 200


def test_agents_and_workspace_tokens_cannot_create_links(client, workspace, people):
    # A prompt-injected agent must not be able to publish a private file.
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    assert _create(client, workspace, fid, _tok(workspace)).status_code == 403
    agent = {**_tok(workspace), "X-Agent-Name": "agent-alpha"}
    assert _create(client, workspace, fid, agent).status_code == 403
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None


def test_expiry(client, db, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert _create(client, workspace, fid, mia, expires_at=past).status_code == 400

    future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    created = _create(client, workspace, fid, mia, expires_at=future).json()["data"]["link"]
    assert created["expires_at"]
    token = created["token"]
    assert client.get(f"/v1/public/shares/{token}").json()["data"]["expires_at"]

    link = db.query(PublicShare).filter(PublicShare.token == token).one()
    link.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    gone = client.get(f"/v1/public/shares/{token}")
    assert gone.status_code == 404
    assert "expired" in gone.text
    assert client.get(f"/v1/public/shares/{token}/content").status_code == 404

    # The panel no longer offers it, and sharing again mints a new link: the
    # expired URL must not come back to life with a new copy.
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None
    fresh = _token(_create(client, workspace, fid, mia))
    assert fresh != token
    assert client.get(f"/v1/public/shares/{token}").status_code == 404
    assert client.get(f"/v1/public/shares/{fresh}").status_code == 200


def test_trashing_revokes_and_restoring_does_not_revive(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    token = _token(_create(client, workspace, fid, mia))
    trashed = client.post("/v1/files/trash", json={"network": workspace["id"], "file_ids": [fid]}, headers=mia)
    assert trashed.status_code == 200, trashed.text
    assert client.get(f"/v1/public/shares/{token}").status_code == 404
    trash_id = trashed.json()["data"]["entries"][0]["trash_id"]
    restored = client.post("/v1/files/trash/restore", json={"network": workspace["id"], "trash_ids": [trash_id]}, headers=mia)
    assert restored.status_code == 200, restored.text
    assert client.get(f"/v1/public/shares/{token}").status_code == 404
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None


def test_a_replaced_file_keeps_its_link(client, workspace, people):
    mia = _bearer("mia", workspace)
    r = client.post("/v1/files/upload", files=[("files", ("page.md", b"# one", "text/markdown"))],
                    data={"network": workspace["id"]}, headers=mia)
    assert r.status_code == 200, r.text
    fid = r.json()["data"]["files"][0]["id"]
    token = _token(_create(client, workspace, fid, mia))
    r = client.post("/v1/files/upload", files=[("files", ("page.md", b"# two", "text/markdown"))],
                    data={"network": workspace["id"], "on_conflict": "replace"}, headers=mia)
    assert r.status_code == 200, r.text
    new_id = r.json()["data"]["files"][0]["id"]
    assert new_id != fid
    assert client.get(f"/v1/public/shares/{token}/content").content == b"# one"
    assert _token(_create(client, workspace, new_id, mia)) == token
    assert client.get(f"/v1/public/shares/{token}/content").content == b"# two"


def test_link_dies_when_its_creator_leaves_the_workspace(client, db, workspace, people):
    adam, mia = _bearer("adam", workspace), _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    token = _token(_create(client, workspace, fid, adam))
    assert client.get(f"/v1/public/shares/{token}").status_code == 200
    adam_id = db.query(User).filter(User.email == "adam@acme.test").one().id
    db.execute(delete(WorkspaceMembership).where(WorkspaceMembership.user_id == adam_id))
    db.commit()
    assert client.get(f"/v1/public/shares/{token}").status_code == 404
    assert client.get(f"/v1/public/shares/{token}/content").status_code == 404


def test_unknown_token_is_404(client):
    for url in ("/v1/public/shares/nope", "/v1/public/shares/nope/content", "/v1/public/shares/nope/assets/0"):
        r = client.get(url)
        assert r.status_code == 404
        assert r.headers["referrer-policy"] == "no-referrer"


def test_video_seeks_with_ranges(client, workspace, people):
    mia = _bearer("mia", workspace)
    data = bytes(range(256)) * 4
    fid = _upload(client, workspace, mia, "clip.mp4", data, "video/mp4")
    token = _token(_create(client, workspace, fid, mia))
    whole = client.get(f"/v1/public/shares/{token}/content")
    assert whole.headers["accept-ranges"] == "bytes"
    part = client.get(f"/v1/public/shares/{token}/content", headers={"Range": "bytes=100-199"})
    assert part.status_code == 206
    assert part.content == data[100:200]
    assert part.headers["content-range"] == f"bytes 100-199/{len(data)}"
    tail = client.get(f"/v1/public/shares/{token}/content", headers={"Range": "bytes=-10"})
    assert tail.status_code == 206 and tail.content == data[-10:]
    assert client.get(f"/v1/public/shares/{token}/content", headers={"Range": f"bytes={len(data)}-"}).status_code == 416


def test_knowledge_documents_can_be_shared(client, workspace, people):
    mia = _bearer("mia", workspace)
    r = client.post("/v1/knowledge", json={"network": workspace["id"], "title": "Launch plan",
                                           "content": "| a | b |\n|---|---|\n| 1 | 2 |"}, headers=mia)
    assert r.status_code == 200, r.text
    kid = r.json()["data"]["id"]
    token = _token(_create(client, workspace, kid, mia, kind="knowledge"))
    info = client.get(f"/v1/public/shares/{token}").json()["data"]
    assert info["kind"] == "knowledge" and info["title"] == "Launch plan"
    assert info["content_type"] == "text/markdown"
    assert client.get(f"/v1/public/shares/{token}/content").content.startswith(b"| a | b |")
    assert client.delete(f"/v1/knowledge/{kid}?network={workspace['id']}", headers=mia).status_code == 200
    assert client.get(f"/v1/public/shares/{token}").status_code == 404


def test_images_a_document_embeds_are_copied_with_it(client, workspace, people):
    mia = _bearer("mia", workspace)
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    img = _upload(client, workspace, mia, "chart.png", png, "image/png")
    doc = (f"# Report\n\n![chart](/v1/files/{img})\n\n<img src=\"/{workspace['slug']}/files/{img}\">\n\n"
           f"![bare]({img})\n\n![x](https://example.com/a.png)")
    fid = _upload(client, workspace, mia, "report.md", doc.encode(), "text/markdown")
    token = _token(_create(client, workspace, fid, mia))
    shared = client.get(f"/v1/public/shares/{token}/content").text
    assert "![chart](oa-share-asset:0)" in shared
    assert '<img src="oa-share-asset:0">' in shared, "one copy per image"
    assert "![bare](oa-share-asset:0)" in shared
    assert "https://example.com/a.png" in shared, "outside links are left alone"
    assert f"/v1/files/{img}" not in shared
    asset = client.get(f"/v1/public/shares/{token}/assets/0")
    assert asset.status_code == 200 and asset.content == png
    assert client.get(f"/v1/public/shares/{token}/assets/1").status_code == 404


def test_html_renders_only_on_the_share_domain(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "page.html", b"<html><head></head><body>hi</body></html>", "text/html")
    token = _token(_create(client, workspace, fid, mia))
    assert client.get(f"/v1/public/shares/{token}").json()["data"]["render_url"] is None
    assert client.get(f"/v1/public/shares/{token}/site/index.html").status_code == 404

    monkeypatch.setattr(config, "SHARE_CONTENT_HOST", "oa-share.test")
    info = client.get(f"/v1/public/shares/{token}").json()["data"]
    assert info["render_url"] == f"https://oa-share.test/v1/public/shares/{token}/site/index.html"
    # Never on the API's own host, even with the share domain configured.
    assert client.get(f"/v1/public/shares/{token}/site/index.html").status_code == 404
    page = client.get(f"/v1/public/shares/{token}/site/index.html", headers={"Host": "oa-share.test"})
    assert page.status_code == 200
    assert b"hi" in page.content
    csp = page.headers["content-security-policy"]
    assert csp.startswith("sandbox allow-scripts;") and "form-action 'none'" in csp
    assert "connect-src oa-share.test/v1/public/shares/" in csp
    assert client.get(f"/v1/public/shares/{token}/site/other.html", headers={"Host": "oa-share.test"}).status_code == 404


def test_web_projects_can_be_shared_and_render_on_the_share_domain(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    files = [{"path": "index.html", "content_base64": base64.b64encode(b"<html><head></head><body><script src='app.js'></script></body></html>").decode()},
             {"path": "app.js", "content_base64": base64.b64encode(b"console.log(1)").decode()}]
    r = client.post("/v1/web-projects", json={"network": workspace["id"], "title": "Demo", "files": files}, headers=mia)
    assert r.status_code == 200, r.text
    pid = r.json()["data"]["id"]
    token = _token(_create(client, workspace, pid, mia))
    monkeypatch.setattr(config, "SHARE_CONTENT_HOST", "oa-share.test")
    info = client.get(f"/v1/public/shares/{token}").json()["data"]
    assert info["web_project"] is True
    assert info["render_url"].endswith(f"/v1/public/shares/{token}/site/index.html")
    js = client.get(f"/v1/public/shares/{token}/site/app.js", headers={"Host": "oa-share.test"})
    assert js.status_code == 200 and js.headers["content-type"].startswith("text/javascript")
    assert client.get(f"/v1/public/shares/{token}/site/__openagents_project__.json", headers={"Host": "oa-share.test"}).status_code == 404


def test_storage_errors_read_as_not_found(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    token = _token(_create(client, workspace, fid, mia))

    class MissingObject:
        def read(self, key):
            raise RuntimeError("NoSuchKey")  # S3's own error type, not FileNotFoundError

    monkeypatch.setattr(public_routes, "get_file_store", lambda: MissingObject())
    assert client.get(f"/v1/public/shares/{token}/content").status_code == 404


# ---------------------------------------------------------------------------
# An agent asks; a person approves
# ---------------------------------------------------------------------------

def _agent_request(client, ws, fid, **extra):
    return client.post("/v1/public-shares/requests", json={
        "network": ws["id"], "channel": ws["channel"]["name"], "kind": "file", "id": fid,
        "source": "openagents:agent-alpha", "reason": "The user asked to share the report", **extra,
    }, headers={**_tok(ws), "X-Agent-Name": "agent-alpha"})


def test_an_agent_request_publishes_only_once_a_person_approves(client, db, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "report.md", b"# done", "text/markdown")
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200

    r = _agent_request(client, workspace, fid)
    assert r.status_code == 200, r.text
    approval = r.json()["data"]
    assert approval["status"] == "pending" and approval["kind"] == "public_share_request"
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None, "nothing is published yet"
    # Asking twice files one request.
    assert _agent_request(client, workspace, fid).json()["data"]["id"] == approval["id"]

    # The agent's own token can't approve it.
    assert client.post(f"/v1/approvals/{approval['id']}/approve", json={"network": workspace["id"]},
                       headers=_tok(workspace)).status_code == 403

    done = client.post(f"/v1/approvals/{approval['id']}/approve", json={"network": workspace["id"]}, headers=mia)
    assert done.status_code == 200, done.text
    link = db.query(PublicShare).filter(PublicShare.resource_id == fid, PublicShare.revoked_at.is_(None)).one()
    assert link.created_by == "human:mia@acme.test"
    assert link.approval_id == approval["id"]
    assert link.token in done.json()["data"]["note"], "the agent is told the link"
    assert client.get(f"/v1/public/shares/{link.token}/content").content == b"# done"


def test_an_approver_must_be_able_to_manage_the_artifact(client, db, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "report.md", b"# done", "text/markdown")
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    approval = _agent_request(client, workspace, fid).json()["data"]
    # Another member can read the file but not manage it.
    db.add(User(email="max@acme.test", display_name="Max"))
    db.flush()
    max_id = db.query(User).filter(User.email == "max@acme.test").one().id
    db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=max_id, role="member"))
    db.commit()
    people["max"] = _claims("max@acme.test", "Max")
    r = client.post(f"/v1/approvals/{approval['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("max", workspace))
    assert r.status_code == 403, r.text
    assert "owner or an admin" in r.text
    assert db.get(ApprovalRequest, approval["id"]).status == "pending"
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None


def test_rejecting_publishes_nothing(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    approval = _agent_request(client, workspace, fid).json()["data"]
    r = client.post(f"/v1/approvals/{approval['id']}/reject", json={"network": workspace["id"]}, headers=mia)
    assert r.status_code == 200, r.text
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None


def test_an_agent_cannot_request_what_it_cannot_read(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)  # private to mia
    assert _agent_request(client, workspace, fid).status_code == 403


def test_agents_cannot_snapshot_a_thread(client, workspace, people):
    agent = {**_tok(workspace), "X-Agent-Name": "agent-alpha"}
    r = client.post("/v1/shares", json={"network": workspace["id"], "channel": workspace["channel"]["name"]}, headers=agent)
    assert r.status_code == 403


def test_only_images_the_sharer_manages_are_copied(client, workspace, people):
    adam, mia = _bearer("adam", workspace), _bearer("mia", workspace)
    png = b"\x89PNG\r\n\x1a\nfake"
    theirs = _upload(client, workspace, adam, "admins.png", png, "image/png")
    # mia can see adam's image, but publishing it is not hers to decide.
    assert client.patch(f"/v1/files/{theirs}", json={"network": workspace["id"], "visibility": "public"}, headers=adam).status_code == 200
    mine = _upload(client, workspace, mia, "mine.png", png, "image/png")
    doc = f"![a](/v1/files/{theirs})\n![b](/v1/files/{mine})\n\n```\n![c](/v1/files/{mine})\n```\n`![d](/v1/files/{mine})`"
    fid = _upload(client, workspace, mia, "doc.md", doc.encode(), "text/markdown")
    token = _token(_create(client, workspace, fid, mia))
    shared = client.get(f"/v1/public/shares/{token}/content").text
    assert f"![a](/v1/files/{theirs})" in shared
    assert "![b](oa-share-asset:0)" in shared
    assert f"![c](/v1/files/{mine})" in shared and f"`![d](/v1/files/{mine})`" in shared, "code is left alone"
    assert client.get(f"/v1/public/shares/{token}/assets/1").status_code == 404


def test_approving_refuses_an_artifact_changed_since_the_request(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "report.md", b"# asked", "text/markdown")
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    approval = _agent_request(client, workspace, fid).json()["data"]
    assert client.put(f"/v1/files/{fid}/content", json={"network": workspace["id"], "content": "# swapped"}, headers=mia).status_code == 200
    r = client.post(f"/v1/approvals/{approval['id']}/approve", json={"network": workspace["id"]}, headers=mia)
    assert r.status_code == 409, r.text
    assert _link(client, workspace, fid, mia).json()["data"]["link"] is None


def test_agents_never_get_the_token(client, workspace, people):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia)
    assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=mia).status_code == 200
    _token(_create(client, workspace, fid, mia))
    for headers in (_tok(workspace), {**_tok(workspace), "X-Agent-Name": "agent-alpha"}):
        seen = _link(client, workspace, fid, headers).json()["data"]
        assert seen["can_manage"] is False and "token" not in seen["link"]
        assert _revoke(client, workspace, fid, headers).status_code == 403


def test_odd_titles_still_share(client, workspace, people):
    mia = _bearer("mia", workspace)
    r = client.post("/v1/knowledge", json={"network": workspace["id"], "title": "..", "content": "x"}, headers=mia)
    assert r.status_code == 200, r.text
    token = _token(_create(client, workspace, r.json()["data"]["id"], mia, kind="knowledge"))
    assert client.get(f"/v1/public/shares/{token}/content").status_code == 200
    long_title = "报告" * 120
    r = client.post("/v1/knowledge", json={"network": workspace["id"], "title": long_title, "content": "y"}, headers=mia)
    assert r.status_code == 200, r.text
    token = _token(_create(client, workspace, r.json()["data"]["id"], mia, kind="knowledge"))
    assert client.get(f"/v1/public/shares/{token}/content").status_code == 200


def test_the_share_domain_serves_nothing_but_shared_pages(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "page.html", b"<html><head></head><body>hi</body></html>", "text/html")
    token = _token(_create(client, workspace, fid, mia))
    monkeypatch.setattr(config, "SHARE_CONTENT_HOST", "oa-share.test")
    share = {"Host": "oa-share.test"}
    assert client.get(f"/v1/public/shares/{token}/site/index.html", headers=share).status_code == 200
    assert client.get("/health", headers=share).status_code == 200
    # The rest of the API — even the public metadata — does not answer there.
    for url in (f"/v1/public/shares/{token}", f"/v1/public/shares/{token}/content",
                f"/v1/files?network={workspace['id']}", "/v1/workspaces"):
        assert client.get(url, headers={**share, **mia}).status_code == 404, url
    assert client.post("/v1/public-shares", json={"network": workspace["id"], "kind": "file", "id": fid},
                       headers={**share, **mia}).status_code == 404
    # The API's own host is unaffected.
    assert client.get(f"/v1/public/shares/{token}").status_code == 200


# ---------------------------------------------------------------------------
# The viewer on the share domain: https://<share host>/<token>
# ---------------------------------------------------------------------------

SHARE = {"Host": "oa-share.test"}


def _shared(client, workspace, mia, name, data, content_type, monkeypatch):
    fid = _upload(client, workspace, mia, name, data, content_type)
    monkeypatch.setattr(config, "SHARE_CONTENT_HOST", "oa-share.test")
    created = _create(client, workspace, fid, mia).json()["data"]["link"]
    return created["token"], created


def test_links_are_handed_out_on_the_share_domain(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    token, created = _shared(client, workspace, mia, "a.png", b"\x89PNG", "image/png", monkeypatch)
    assert created["url"] == f"https://oa-share.test/{token}"
    assert client.get(f"/v1/public/shares/{token}").json()["data"]["public_url"] == f"https://oa-share.test/{token}"


def test_the_viewer_embeds_media_from_the_share_domain(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    data = b"\x89PNG\r\n\x1a\n" + bytes(200)
    token, _ = _shared(client, workspace, mia, "chart.png", data, "image/png", monkeypatch)
    page = client.get(f"/{token}", headers=SHARE)
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    assert f'<img src="/{token}/raw"' in page.text and "chart.png" in page.text
    assert f'href="/{token}/download"' in page.text
    csp = page.headers["content-security-policy"]
    assert "default-src 'none'" in csp and "script-src" not in csp and "form-action 'none'" in csp
    assert page.headers["referrer-policy"] == "no-referrer"
    raw = client.get(f"/{token}/raw", headers=SHARE)
    assert raw.status_code == 200 and raw.content == data
    assert raw.headers["content-disposition"].startswith("inline")
    assert raw.headers["content-security-policy"] == "sandbox"
    assert client.get(f"/{token}/raw", headers={**SHARE, "Range": "bytes=0-7"}).status_code == 206
    download = client.get(f"/{token}/download", headers=SHARE)
    assert download.status_code == 200 and download.headers["content-disposition"].startswith("attachment")


def test_the_viewer_never_answers_on_the_api_host(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    token, _ = _shared(client, workspace, mia, "notes.md", b"# hi", "text/markdown", monkeypatch)
    assert client.get(f"/v1/public/shares/{token}/view").status_code == 404
    assert client.get(f"/v1/public/shares/{token}/raw").status_code == 404


def test_markdown_renders_escaped_with_its_images(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    png = b"\x89PNG\r\n\x1a\nfake"
    img = _upload(client, workspace, mia, "pic.png", png, "image/png")
    doc = (f"# Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![pic](/v1/files/{img})\n\n"
           "<script>alert(1)</script>\n\n[x](javascript:alert(1))")
    token, _ = _shared(client, workspace, mia, "plan.md", doc.encode(), "text/markdown", monkeypatch)
    page = client.get(f"/{token}", headers=SHARE).text
    assert "<h1>Plan</h1>" in page and "<table>" in page
    assert f'src="/{token}/assets/0"' in page
    assert "<script>" not in page and "&lt;script&gt;" in page
    assert 'href="javascript:' not in page
    assert client.get(f"/{token}/assets/0", headers=SHARE).content == png


def test_csv_renders_as_a_table(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    token, _ = _shared(client, workspace, mia, "q3.csv", b'name,note\nacme,"<b>big</b>"\n', "text/csv", monkeypatch)
    page = client.get(f"/{token}", headers=SHARE).text
    assert "<th>name</th>" in page and "&lt;b&gt;big&lt;/b&gt;" in page


def test_web_pages_are_framed_under_the_user_content_banner(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    token, _ = _shared(client, workspace, mia, "page.html", b"<html><head></head><body>hi</body></html>", "text/html", monkeypatch)
    page = client.get(f"/{token}", headers=SHARE).text
    assert f'src="/v1/public/shares/{token}/site/index.html" sandbox="allow-scripts"' in page
    assert "not by OpenAgents" in page
    # HTML is never served inline from /raw: only framed from /site/.
    assert client.get(f"/{token}/raw", headers=SHARE).status_code == 404


def test_dead_links_show_a_page_saying_so(client, workspace, people, monkeypatch):
    mia = _bearer("mia", workspace)
    fid = _upload(client, workspace, mia, "a.txt", b"x", "text/plain")
    monkeypatch.setattr(config, "SHARE_CONTENT_HOST", "oa-share.test")
    token = _token(_create(client, workspace, fid, mia))
    assert _revoke(client, workspace, fid, mia).status_code == 200
    page = client.get(f"/{token}", headers={**SHARE, "Accept-Language": "zh-CN,zh;q=0.9"})
    assert page.status_code == 404 and "此链接已失效" in page.text
    assert "This link is no longer available" in client.get(f"/{token}", headers=SHARE).text
    assert client.get("/", headers=SHARE).status_code == 404

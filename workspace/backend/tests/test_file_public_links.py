# -*- coding: utf-8 -*-
"""Public "anyone with the link" file links: who may create and revoke them,
and what the unauthenticated routes serve."""

from tests.test_visibility import _bearer, no_push, people  # noqa: F401


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
    assert client.get("/v1/public/files/nope").status_code == 404
    assert client.get("/v1/public/files/nope/content").status_code == 404

# -*- coding: utf-8 -*-
"""Public links to files: a manager opens one, anyone holding it reads the
file without signing in, and revoking or trashing it closes the door."""

from tests.test_groups_grants import E, _upload
from tests.test_visibility import _bearer, _tok, no_push, people  # noqa: F401


def _link(client, ws, headers, fid, method="get"):
    return getattr(client, method)(f"/v1/files/{fid}/public-link?network={ws['id']}", headers=headers)


def test_manager_opens_link_and_anyone_reads(client, workspace, people):
    mia, vic = _bearer("mia", workspace), _bearer("vic", workspace)
    fid = _upload(client, workspace, mia, "plan.txt").json()["data"]["id"]

    assert _link(client, workspace, mia, fid).json()["data"]["link"] is None
    # not a manager of mia's file
    assert _link(client, workspace, vic, fid, "post").status_code == 403
    assert _link(client, workspace, vic, fid).status_code == 403

    r = _link(client, workspace, mia, fid, "post")
    assert r.status_code == 200, r.text
    link = r.json()["data"]["link"]
    assert link["url"].endswith(f"/v1/public/files/{link['token']}")
    assert link["created_by"] == E["mia"]
    # idempotent: the live link comes back
    assert _link(client, workspace, mia, fid, "post").json()["data"]["link"]["token"] == link["token"]
    assert _link(client, workspace, mia, fid).json()["data"]["link"]["token"] == link["token"]

    r = client.get(f"/v1/public/files/{link['token']}")
    assert r.status_code == 200
    assert r.content == b"hello"
    assert r.headers["content-disposition"].startswith("attachment;")
    assert r.headers["x-content-type-options"] == "nosniff"

    assert _link(client, workspace, mia, fid, "delete").status_code == 200
    assert client.get(f"/v1/public/files/{link['token']}").status_code == 404
    assert _link(client, workspace, mia, fid).json()["data"]["link"] is None
    # a new link is a new token
    again = _link(client, workspace, mia, fid, "post").json()["data"]["link"]
    assert again["token"] != link["token"]


def test_trashed_file_stops_serving(client, workspace):
    headers = _tok(workspace)
    fid = _upload(client, workspace, headers, "a.png", source="human:user").json()["data"]["id"]
    token = _link(client, workspace, headers, fid, "post").json()["data"]["link"]["token"]
    assert client.get(f"/v1/public/files/{token}").status_code == 200
    r = client.post("/v1/files/trash", json={"network": workspace["id"], "file_ids": [fid]}, headers=headers)
    assert r.status_code == 200, r.text
    assert client.get(f"/v1/public/files/{token}").status_code == 404


def test_unknown_token(client):
    assert client.get("/v1/public/files/nope").status_code == 404

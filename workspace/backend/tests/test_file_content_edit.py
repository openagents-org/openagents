# -*- coding: utf-8 -*-
"""
Tests for PUT /v1/files/{file_id}/content — saving an edited markdown file.

Markdown only: other kinds are refused. A save carrying the hash of the bytes
the editor opened is refused with 409 when the file changed in between.
"""

import hashlib

from app.models import FileRecord
from app.storage import get_file_store


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _upload(client, workspace, filename, data, content_type):
    resp = client.post(
        "/v1/files",
        data={"network": workspace["id"]},
        files={"file": (filename, data, content_type)},
        headers=_headers(workspace),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["id"]


def _put(client, workspace, file_id, **body):
    return client.put(
        f"/v1/files/{file_id}/content",
        json={"network": workspace["id"], **body},
        headers=_headers(workspace),
    )


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_saves_markdown_in_place(client, db, workspace):
    original = b"# Notes\n\nfirst draft\n"
    file_id = _upload(client, workspace, "notes.md", original, "text/markdown")

    edited = "# Notes\n\nsecond draft — 编辑\n"
    resp = _put(client, workspace, file_id, content=edited, base_sha256=_sha(original))
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["id"] == file_id
    assert data["size"] == len(edited.encode("utf-8"))
    assert data["sha256"] == _sha(edited.encode("utf-8"))

    download = client.get(f"/v1/files/{file_id}", headers=_headers(workspace))
    assert download.status_code == 200
    assert download.content.decode("utf-8") == edited

    record = db.query(FileRecord).filter(FileRecord.id == file_id).one()
    assert get_file_store().read(record.storage_key).decode("utf-8") == edited


def test_refuses_a_stale_save(client, workspace):
    original = b"v1\n"
    file_id = _upload(client, workspace, "doc.md", original, "text/markdown")
    assert _put(client, workspace, file_id, content="v2\n", base_sha256=_sha(original)).status_code == 200

    stale = _put(client, workspace, file_id, content="v2 from someone else\n", base_sha256=_sha(original))
    assert stale.status_code == 409

    download = client.get(f"/v1/files/{file_id}", headers=_headers(workspace))
    assert download.content == b"v2\n"


def test_refuses_non_markdown(client, workspace):
    file_id = _upload(client, workspace, "data.txt", b"plain", "text/plain")
    resp = _put(client, workspace, file_id, content="changed")
    assert resp.status_code == 400


def test_unknown_file_is_404(client, workspace):
    assert _put(client, workspace, "does-not-exist", content="x").status_code == 404


def test_requires_a_valid_token(client, workspace):
    file_id = _upload(client, workspace, "a.md", b"a", "text/markdown")
    resp = client.put(
        f"/v1/files/{file_id}/content",
        json={"network": workspace["id"], "content": "b"},
        headers={"X-Workspace-Token": "wrong"},
    )
    assert resp.status_code == 401

# -*- coding: utf-8 -*-
"""
Tests for the trash:

    POST /v1/files/trash          move files/folders to the trash
    GET  /v1/files/trash          list it
    POST /v1/files/trash/restore  put entries back
    POST /v1/files/trash/purge    destroy them for good

All four are additions. The existing DELETE routes still soft-delete exactly as
they did; what's new is that a deletion now records when it happened and which
records went away together, so it can be shown and undone. Records deleted the
old way (no trash metadata) must still show up — there's a test for that.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models import FileRecord
from app.storage import get_file_store

BASE_TIME = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _add_files(db, workspace, entries):
    """Insert active file records directly. `entries` is (filename, content_type, size)."""
    for i, (filename, content_type, size) in enumerate(entries):
        db.add(FileRecord(
            workspace_id=workspace["id"],
            filename=filename,
            content_type=content_type,
            size=size,
            storage_key=f"test/{workspace['id']}/{i}",
            uploaded_by="human:user",
            status="active",
            created_at=BASE_TIME + timedelta(minutes=i),
        ))
    db.commit()


def _file_id(db, workspace, filename):
    return db.query(FileRecord).filter(
        FileRecord.workspace_id == workspace["id"],
        FileRecord.filename == filename,
        FileRecord.status == "active",
    ).one().id


def _trash(client, workspace, **body):
    resp = client.post(
        "/v1/files/trash",
        json={"network": workspace["id"], **body},
        headers=_headers(workspace),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _list_trash(client, workspace):
    resp = client.get(
        f"/v1/files/trash?network={workspace['id']}", headers=_headers(workspace)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _restore(client, workspace, **body):
    resp = client.post(
        "/v1/files/trash/restore",
        json={"network": workspace["id"], **body},
        headers=_headers(workspace),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _purge(client, workspace, **body):
    resp = client.post(
        "/v1/files/trash/purge",
        json={"network": workspace["id"], **body},
        headers=_headers(workspace),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _browse_names(client, workspace, path=""):
    resp = client.get(
        f"/v1/files/browse?network={workspace['id']}&path={path}&recursive=true",
        headers=_headers(workspace),
    )
    return [f["relative_name"] for f in resp.json()["data"]["files"]]


@pytest.fixture
def populated(db, workspace):
    """
        docs/report.pdf
        docs/notes.md
        docs/deep/data.csv
        media/shot.png
        top.txt
        empty/.keep
    """
    _add_files(db, workspace, [
        ("docs/report.pdf", "application/pdf", 300),
        ("docs/notes.md", "text/markdown", 40),
        ("docs/deep/data.csv", "text/csv", 120),
        ("media/shot.png", "image/png", 900),
        ("top.txt", "text/plain", 10),
        ("empty/.keep", "application/octet-stream", 0),
    ])
    return workspace


# ---------------------------------------------------------------------------
# POST /v1/files/trash
# ---------------------------------------------------------------------------

class TestMoveToTrash:

    def test_trashes_a_single_file(self, client, db, populated):
        file_id = _file_id(db, populated, "top.txt")
        entry = _trash(client, populated, file_ids=[file_id])["data"]["entries"][0]

        assert entry["kind"] == "file"
        assert entry["path"] == "top.txt"
        assert entry["file_count"] == 1
        assert "top.txt" not in _browse_names(client, populated)

    def test_trashes_a_folder_as_one_entry(self, client, populated):
        data = _trash(client, populated, paths=["docs"])["data"]
        entry = data["entries"][0]

        assert len(data["entries"]) == 1        # one entry, not three files
        assert entry["kind"] == "folder"
        assert entry["path"] == "docs"
        assert entry["file_count"] == 3         # includes docs/deep/data.csv
        assert entry["size"] == 460
        assert _browse_names(client, populated) == ["media/shot.png", "top.txt"]

    def test_trashes_files_and_folders_together(self, client, db, populated):
        file_id = _file_id(db, populated, "top.txt")
        data = _trash(client, populated, file_ids=[file_id], paths=["media"])["data"]

        assert {e["kind"] for e in data["entries"]} == {"file", "folder"}
        assert data["trashed_count"] == 2

    def test_empty_folder_is_trashable(self, client, populated):
        entry = _trash(client, populated, paths=["empty"])["data"]["entries"][0]

        assert entry["kind"] == "folder"
        assert entry["file_count"] == 0         # the .keep is not a file

    def test_reports_what_it_could_not_find(self, client, populated):
        data = _trash(client, populated, file_ids=["no-such-id"], paths=["nope"])["data"]

        assert data["entries"] == []
        assert set(data["not_found"]) == {"no-such-id", "nope"}

    def test_a_stale_id_does_not_block_the_rest(self, client, db, populated):
        file_id = _file_id(db, populated, "top.txt")
        data = _trash(client, populated, file_ids=[file_id, "gone"])["data"]

        assert data["trashed_count"] == 1
        assert data["not_found"] == ["gone"]

    def test_requires_something_to_delete(self, client, populated):
        resp = client.post(
            "/v1/files/trash",
            json={"network": populated["id"]},
            headers=_headers(populated),
        )
        assert resp.json()["code"] == 400

    def test_requires_a_valid_token(self, client, populated):
        resp = client.post("/v1/files/trash", json={"network": populated["id"], "paths": ["docs"]})
        assert resp.json()["code"] == 401


# ---------------------------------------------------------------------------
# GET /v1/files/trash
# ---------------------------------------------------------------------------

class TestListTrash:

    def test_empty_to_begin_with(self, client, populated):
        data = _list_trash(client, populated)

        assert data["entries"] == []
        assert data["total"] == 0

    def test_one_entry_per_delete_action(self, client, db, populated):
        _trash(client, populated, paths=["docs"])
        _trash(client, populated, file_ids=[_file_id(db, populated, "top.txt")])
        data = _list_trash(client, populated)

        assert data["total"] == 2               # not 4 loose files
        assert data["file_total"] == 4
        assert {e["kind"] for e in data["entries"]} == {"folder", "file"}

    def test_newest_first(self, client, db, populated):
        _trash(client, populated, paths=["docs"])
        _trash(client, populated, file_ids=[_file_id(db, populated, "top.txt")])
        entries = _list_trash(client, populated)["entries"]

        assert entries[0]["path"] == "top.txt"

    def test_folder_entry_previews_its_files(self, client, populated):
        _trash(client, populated, paths=["docs"])
        entry = _list_trash(client, populated)["entries"][0]

        assert entry["name"] == "docs"
        assert [f["filename"] for f in entry["files"]] == [
            "docs/deep/data.csv", "docs/notes.md", "docs/report.pdf",
        ]
        assert entry["files"][0]["kind"] == "sheet"

    def test_records_deleted_the_old_way_still_show_up(self, client, db, populated):
        """DELETE /v1/files/{id} predates the trash and writes no metadata."""
        file_id = _file_id(db, populated, "top.txt")
        resp = client.delete(f"/v1/files/{file_id}", headers=_headers(populated))
        assert resp.status_code == 200

        entries = _list_trash(client, populated)["entries"]
        assert len(entries) == 1
        assert entries[0]["kind"] == "file"
        assert entries[0]["path"] == "top.txt"
        assert entries[0]["deleted_at"] is None     # nothing recorded it
        assert entries[0]["trash_id"] == file_id    # its own id stands in

    def test_old_folder_deletes_stay_loose(self, client, populated):
        """DELETE /files/folders tags nothing, so its files can't be regrouped."""
        resp = client.delete(
            f"/v1/files/folders?network={populated['id']}&path=docs",
            headers=_headers(populated),
        )
        assert resp.status_code == 200

        data = _list_trash(client, populated)
        assert data["total"] == 3               # three separate file entries
        assert data["file_total"] == 3

    def test_requires_a_valid_token(self, client, populated):
        resp = client.get(f"/v1/files/trash?network={populated['id']}")
        assert resp.json()["code"] == 401


# ---------------------------------------------------------------------------
# POST /v1/files/trash/restore
# ---------------------------------------------------------------------------

class TestRestore:

    def test_restores_a_file(self, client, db, populated):
        file_id = _file_id(db, populated, "top.txt")
        trash_id = _trash(client, populated, file_ids=[file_id])["data"]["entries"][0]["trash_id"]

        data = _restore(client, populated, trash_ids=[trash_id])["data"]

        assert data["restored_count"] == 1
        assert "top.txt" in _browse_names(client, populated)
        assert _list_trash(client, populated)["total"] == 0

    def test_restores_a_folder_whole(self, client, populated):
        trash_id = _trash(client, populated, paths=["docs"])["data"]["entries"][0]["trash_id"]

        _restore(client, populated, trash_ids=[trash_id])

        assert sorted(_browse_names(client, populated, "docs")) == [
            "deep/data.csv", "notes.md", "report.pdf",
        ]

    def test_restores_everything(self, client, db, populated):
        _trash(client, populated, paths=["docs"])
        _trash(client, populated, file_ids=[_file_id(db, populated, "top.txt")])

        data = _restore(client, populated, all=True)["data"]

        assert data["restored_count"] == 4
        assert _list_trash(client, populated)["total"] == 0

    def test_renames_around_a_name_taken_since(self, client, db, populated):
        file_id = _file_id(db, populated, "top.txt")
        trash_id = _trash(client, populated, file_ids=[file_id])["data"]["entries"][0]["trash_id"]
        _add_files(db, populated, [("top.txt", "text/plain", 99)])   # a new file took the name

        data = _restore(client, populated, trash_ids=[trash_id])["data"]

        assert data["entries"][0]["renamed_count"] == 1
        assert data["entries"][0]["files"][0]["filename"] == "top (2).txt"
        # both survive — restoring never overwrites
        assert sorted(n for n in _browse_names(client, populated) if n.startswith("top")) == [
            "top (2).txt", "top.txt",
        ]

    def test_restores_a_folder_that_no_longer_exists(self, client, populated):
        """Folders are path prefixes, so restoring the files rebuilds the folder."""
        trash_id = _trash(client, populated, paths=["media"])["data"]["entries"][0]["trash_id"]
        assert "media" not in [
            f["path"] for f in
            client.get(
                f"/v1/files/browse?network={populated['id']}", headers=_headers(populated)
            ).json()["data"]["folders"]
        ]

        _restore(client, populated, trash_ids=[trash_id])

        folders = client.get(
            f"/v1/files/browse?network={populated['id']}", headers=_headers(populated)
        ).json()["data"]["folders"]
        assert "media" in [f["path"] for f in folders]

    def test_restores_an_old_style_delete(self, client, db, populated):
        file_id = _file_id(db, populated, "top.txt")
        client.delete(f"/v1/files/{file_id}", headers=_headers(populated))

        _restore(client, populated, trash_ids=[file_id])

        assert "top.txt" in _browse_names(client, populated)

    def test_reports_unknown_ids(self, client, populated):
        _trash(client, populated, paths=["docs"])
        data = _restore(client, populated, trash_ids=["nope"])["data"]

        assert data["restored_count"] == 0
        assert data["not_found"] == ["nope"]

    def test_requires_ids_or_all(self, client, populated):
        resp = client.post(
            "/v1/files/trash/restore",
            json={"network": populated["id"]},
            headers=_headers(populated),
        )
        assert resp.json()["code"] == 400

    def test_requires_a_valid_token(self, client, populated):
        resp = client.post("/v1/files/trash/restore", json={"network": populated["id"], "all": True})
        assert resp.json()["code"] == 401


# ---------------------------------------------------------------------------
# POST /v1/files/trash/purge
# ---------------------------------------------------------------------------

class TestPurge:

    def test_purges_one_entry(self, client, db, populated):
        _trash(client, populated, paths=["docs"])
        file_id = _file_id(db, populated, "top.txt")
        keep = _trash(client, populated, file_ids=[file_id])["data"]["entries"][0]["trash_id"]
        docs = [e for e in _list_trash(client, populated)["entries"] if e["kind"] == "folder"][0]

        data = _purge(client, populated, trash_ids=[docs["trash_id"]])["data"]

        assert data["purged_count"] == 3
        remaining = _list_trash(client, populated)["entries"]
        assert [e["trash_id"] for e in remaining] == [keep]

    def test_empties_the_whole_trash(self, client, db, populated):
        _trash(client, populated, paths=["docs"], file_ids=[_file_id(db, populated, "top.txt")])

        data = _purge(client, populated, all=True)["data"]

        assert data["entry_count"] == 2
        assert _list_trash(client, populated)["total"] == 0

    def test_purged_records_are_gone_from_the_database(self, client, db, populated):
        _trash(client, populated, paths=["docs"])
        _purge(client, populated, all=True)

        assert db.query(FileRecord).filter(
            FileRecord.workspace_id == populated["id"],
            FileRecord.filename.like("docs/%"),
        ).count() == 0

    def test_purge_removes_the_stored_bytes(self, client, workspace):
        """Soft delete keeps the bytes; purge is what actually frees them."""
        resp = client.post(
            "/v1/files/upload",
            data={"network": workspace["id"], "path": "docs"},
            files=[("files", ("real.txt", b"payload", "text/plain"))],
            headers=_headers(workspace),
        )
        file_id = resp.json()["data"]["files"][0]["id"]

        store = get_file_store()
        key = f"{workspace['id']}/{file_id}/real.txt"
        assert store.exists(key)

        _trash(client, workspace, file_ids=[file_id])
        assert store.exists(key)        # still recoverable

        _purge(client, workspace, all=True)
        assert not store.exists(key)

    def test_purging_does_not_touch_live_files(self, client, db, populated):
        _trash(client, populated, paths=["docs"])
        _purge(client, populated, all=True)

        assert sorted(_browse_names(client, populated)) == ["media/shot.png", "top.txt"]

    def test_purged_entries_cannot_be_restored(self, client, populated):
        trash_id = _trash(client, populated, paths=["docs"])["data"]["entries"][0]["trash_id"]
        _purge(client, populated, all=True)

        data = _restore(client, populated, trash_ids=[trash_id])["data"]

        assert data["restored_count"] == 0
        assert data["not_found"] == [trash_id]

    def test_reports_unknown_ids(self, client, populated):
        _trash(client, populated, paths=["docs"])
        data = _purge(client, populated, trash_ids=["nope"])["data"]

        assert data["purged_count"] == 0
        assert data["not_found"] == ["nope"]

    def test_requires_ids_or_all(self, client, populated):
        resp = client.post(
            "/v1/files/trash/purge",
            json={"network": populated["id"]},
            headers=_headers(populated),
        )
        assert resp.json()["code"] == 400

    def test_requires_a_valid_token(self, client, populated):
        resp = client.post("/v1/files/trash/purge", json={"network": populated["id"], "all": True})
        assert resp.json()["code"] == 401

# -*- coding: utf-8 -*-
"""
Tests for the folder-aware file endpoints:

    GET  /v1/files/browse   list one folder — its subfolders and its files
    POST /v1/files/upload   upload into a folder, keeping the filename

Both are additions. `GET /v1/files` pages at 50 records and leaves the client
to rebuild folders and counts from whatever slice it got; `POST /v1/files`
rewrites bare names into uploaded_files/<timestamp>_<name>. Neither behaviour
changes — these tests cover the new endpoints alongside them.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.file_types import group_for, kind_for
from app.models import FileRecord

BASE_TIME = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _add_files(db, workspace, entries):
    """
    Insert file records directly.

    Going through the upload API would add indirection these read-only
    endpoints don't exercise — and a storage round-trip per fixture file.
    `entries` is (filename, content_type, size); created_at increases with the
    index so ordering has something to sort on.
    """
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


def _browse(client, workspace, **params):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    resp = client.get(
        f"/v1/files/browse?network={workspace['id']}{'&' + query if query else ''}",
        headers=_headers(workspace),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
def populated(db, workspace):
    """
    A small tree:

        docs/report.pdf
        docs/notes.md
        docs/deep/data.csv
        media/shot.png
        media/clip.mp4
        empty/.keep          (an empty folder)
        top.txt              (at the root)
    """
    _add_files(db, workspace, [
        ("docs/report.pdf", "application/pdf", 300),
        ("docs/notes.md", "text/markdown", 40),
        ("docs/deep/data.csv", "text/csv", 120),
        ("media/shot.png", "image/png", 900),
        ("media/clip.mp4", "video/mp4", 5000),
        ("top.txt", "text/plain", 10),
        ("empty/.keep", "application/octet-stream", 0),
    ])
    return workspace


# ---------------------------------------------------------------------------
# GET /v1/files/browse — one level at a time
# ---------------------------------------------------------------------------

class TestBrowseOneLevel:

    def test_root_lists_top_level_folders_only(self, client, populated):
        data = _browse(client, populated)["data"]

        assert [f["path"] for f in data["folders"]] == ["docs", "empty", "media"]
        # docs/deep is a level down — it belongs to the next call
        assert "docs/deep" not in [f["path"] for f in data["folders"]]

    def test_root_lists_root_files_only(self, client, populated):
        data = _browse(client, populated)["data"]

        assert [f["relative_name"] for f in data["files"]] == ["top.txt"]
        assert data["total"] == 1

    def test_expanding_a_folder_returns_its_own_level(self, client, populated):
        data = _browse(client, populated, path="docs")["data"]

        assert data["path"] == "docs"
        assert [f["path"] for f in data["folders"]] == ["docs/deep"]
        assert [f["relative_name"] for f in data["files"]] == ["notes.md", "report.pdf"]

    def test_folder_counts_describe_the_subtree(self, client, populated):
        folders = {f["path"]: f for f in _browse(client, populated)["data"]["folders"]}

        assert folders["docs"]["file_count"] == 2      # report.pdf, notes.md
        assert folders["docs"]["total_count"] == 3     # + deep/data.csv
        assert folders["docs"]["folder_count"] == 1    # deep — so it can expand
        assert folders["media"]["folder_count"] == 0   # a leaf: no expander
        assert folders["docs"]["name"] == "docs"

    def test_empty_folder_is_listed_but_holds_nothing(self, client, populated):
        folders = {f["path"]: f for f in _browse(client, populated)["data"]["folders"]}

        assert folders["empty"]["file_count"] == 0
        assert folders["empty"]["total_count"] == 0
        assert folders["empty"]["folder_count"] == 0

    def test_keep_placeholders_are_never_files(self, client, populated):
        data = _browse(client, populated, path="empty")["data"]

        assert data["files"] == []
        assert data["total"] == 0

    def test_nested_folder_paths_are_absolute_and_relative(self, client, populated):
        folder = _browse(client, populated, path="docs")["data"]["folders"][0]

        assert folder["path"] == "docs/deep"          # what to browse next
        assert folder["relative_path"] == "deep"      # where it sits in this call
        assert folder["depth"] == 0

    def test_rejects_a_path_that_escapes_the_workspace(self, client, populated):
        resp = client.get(
            f"/v1/files/browse?network={populated['id']}&path=../etc",
            headers=_headers(populated),
        )
        assert resp.json()["code"] == 400

    def test_requires_a_valid_token(self, client, populated):
        resp = client.get(f"/v1/files/browse?network={populated['id']}")
        assert resp.json()["code"] == 401


class TestBrowseRecursive:

    def test_flattens_the_whole_subtree(self, client, populated):
        data = _browse(client, populated, recursive="true")["data"]

        assert {f["relative_name"] for f in data["files"]} == {
            "docs/report.pdf", "docs/notes.md", "docs/deep/data.csv",
            "media/shot.png", "media/clip.mp4", "top.txt",
        }
        assert data["total"] == 6

    def test_returns_every_descendant_folder(self, client, populated):
        data = _browse(client, populated, recursive="true")["data"]

        assert [f["path"] for f in data["folders"]] == [
            "docs", "docs/deep", "empty", "media",
        ]
        assert {f["path"]: f["depth"] for f in data["folders"]}["docs/deep"] == 1

    def test_names_stay_relative_to_the_browsed_folder(self, client, populated):
        data = _browse(client, populated, path="docs", recursive="true")["data"]

        assert {f["relative_name"] for f in data["files"]} == {
            "report.pdf", "notes.md", "deep/data.csv",
        }
        # the absolute path is still there to download or delete by
        assert {f["filename"] for f in data["files"]} == {
            "docs/report.pdf", "docs/notes.md", "docs/deep/data.csv",
        }


class TestBrowseInclude:

    def test_files_only(self, client, populated):
        data = _browse(client, populated, include="files")["data"]

        assert data["folders"] == []
        assert data["files"]

    def test_folders_only(self, client, populated):
        data = _browse(client, populated, include="folders")["data"]

        assert data["folders"]
        assert data["files"] == []
        assert data["total"] == 0

    def test_rejects_an_unknown_value(self, client, populated):
        resp = client.get(
            f"/v1/files/browse?network={populated['id']}&include=everything",
            headers=_headers(populated),
        )
        assert resp.json()["code"] == 400


class TestBrowseSearch:

    def test_matches_files_by_name(self, client, populated):
        data = _browse(client, populated, recursive="true", q="report")["data"]

        assert [f["relative_name"] for f in data["files"]] == ["docs/report.pdf"]

    def test_is_case_insensitive(self, client, populated):
        data = _browse(client, populated, recursive="true", q="REPORT")["data"]

        assert data["total"] == 1

    def test_matches_folders_by_their_own_name(self, client, populated):
        """A folder matches on what it's called, not on what's inside it."""
        data = _browse(client, populated, recursive="true", q="report")["data"]

        # docs holds report.pdf, but docs isn't called "report"
        assert data["folders"] == []
        assert [f["relative_name"] for f in data["files"]] == ["docs/report.pdf"]

    def test_matches_files_on_their_path_too(self, client, populated):
        """Searching a folder's name is a reasonable way to ask for its files."""
        data = _browse(client, populated, recursive="true", q="deep")["data"]

        assert [f["path"] for f in data["folders"]] == ["docs/deep"]
        assert [f["relative_name"] for f in data["files"]] == ["docs/deep/data.csv"]

    def test_combines_with_the_type_filter(self, client, populated):
        data = _browse(client, populated, recursive="true", q="docs", type="documents")["data"]

        assert data["total"] == 2      # report.pdf + notes.md, not deep/data.csv
        assert data["type_counts"] == {"documents": 2, "sheets": 1}

    def test_wildcards_are_literal(self, client, db, workspace):
        _add_files(db, workspace, [
            ("logs/100%_done.txt", "text/plain", 10),
            ("logs/other.txt", "text/plain", 10),
        ])
        data = _browse(client, workspace, recursive="true", q="100%25_")["data"]

        assert [f["name"] for f in data["files"]] == ["100%_done.txt"]


class TestBrowseTypeCounts:

    def test_counts_cover_the_whole_scope(self, client, populated):
        data = _browse(client, populated, recursive="true")["data"]

        assert data["type_counts"] == {
            "documents": 3,   # report.pdf, notes.md, top.txt
            "sheets": 1,      # data.csv
            "images": 1,      # shot.png
            "video": 1,       # clip.mp4
        }
        assert data["scope_total"] == 6

    def test_filtering_narrows_files_but_not_counts(self, client, populated):
        data = _browse(client, populated, recursive="true", type="images")["data"]

        assert data["total"] == 1
        assert data["files"][0]["relative_name"] == "media/shot.png"
        # the menu still has to say what the other types would give you
        assert data["type_counts"]["documents"] == 3
        assert data["scope_total"] == 6

    def test_counts_follow_the_folder(self, client, populated):
        data = _browse(client, populated, path="media")["data"]

        assert data["type_counts"] == {"images": 1, "video": 1}

    def test_counts_respect_the_level(self, client, populated):
        """Non-recursive counts describe this level, not the subtree."""
        assert _browse(client, populated, path="docs")["data"]["type_counts"] == {
            "documents": 2,
        }
        assert _browse(client, populated, path="docs", recursive="true")["data"]["type_counts"] == {
            "documents": 2, "sheets": 1,
        }

    def test_reports_kind_and_group_per_file(self, client, populated):
        files = {f["name"]: f for f in _browse(client, populated, path="docs")["data"]["files"]}

        assert files["report.pdf"]["kind"] == "pdf"
        assert files["report.pdf"]["type_group"] == "documents"
        assert files["notes.md"]["kind"] == "markdown"

    def test_rejects_an_unknown_type(self, client, populated):
        resp = client.get(
            f"/v1/files/browse?network={populated['id']}&type=spreadsheets",
            headers=_headers(populated),
        )
        assert resp.json()["code"] == 400


class TestBrowseSortingAndPaging:

    def test_sorts_by_name_ascending_by_default(self, client, populated):
        data = _browse(client, populated, path="docs", recursive="true")["data"]

        assert [f["relative_name"] for f in data["files"]] == [
            "deep/data.csv", "notes.md", "report.pdf",
        ]

    def test_sorts_by_size_largest_first(self, client, populated):
        data = _browse(client, populated, recursive="true", sort="size")["data"]
        sizes = [f["size"] for f in data["files"]]

        assert sizes == sorted(sizes, reverse=True)

    def test_sorts_by_recency_newest_first(self, client, populated):
        data = _browse(client, populated, recursive="true", sort="recent")["data"]
        stamps = [f["created_at"] for f in data["files"]]

        assert stamps == sorted(stamps, reverse=True)

    def test_order_overrides_the_default_direction(self, client, populated):
        data = _browse(client, populated, recursive="true", sort="size", order="asc")["data"]
        sizes = [f["size"] for f in data["files"]]

        assert sizes == sorted(sizes)

    def test_rejects_an_unknown_sort_key(self, client, populated):
        resp = client.get(
            f"/v1/files/browse?network={populated['id']}&sort=colour",
            headers=_headers(populated),
        )
        assert resp.json()["code"] == 400

    def test_paging_walks_the_whole_scope(self, client, populated):
        seen = []
        for offset in (0, 2, 4, 6):
            data = _browse(client, populated, recursive="true", limit=2, offset=offset)["data"]
            assert data["total"] == 6      # total is the scope, not the page
            seen.extend(f["relative_name"] for f in data["files"])

        assert len(seen) == 6 and len(set(seen)) == 6

    def test_sees_past_the_flat_list_page_limit(self, client, db, workspace):
        """The whole point: GET /v1/files caps at 50, browse doesn't."""
        _add_files(db, workspace, [
            (f"bulk/file-{i:03d}.txt", "text/plain", 10) for i in range(60)
        ])

        flat = client.get(
            f"/v1/files?network={workspace['id']}", headers=_headers(workspace)
        ).json()["data"]
        assert len(flat["files"]) == 50        # unchanged, still paging

        data = _browse(client, workspace, path="bulk", limit=500)["data"]
        assert data["total"] == 60
        assert len(data["files"]) == 60

        folder = _browse(client, workspace)["data"]["folders"][0]
        assert folder["file_count"] == 60
        assert folder["total_count"] == 60


# ---------------------------------------------------------------------------
# POST /v1/files/upload
# ---------------------------------------------------------------------------

def _upload(client, workspace, files, **fields):
    """files: list of (filename, content, content_type)."""
    resp = client.post(
        "/v1/files/upload",
        data={"network": workspace["id"], **fields},
        files=[("files", f) for f in files],
        headers=_headers(workspace),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestUploadToFolder:

    def test_keeps_the_filename_and_lands_in_the_folder(self, client, workspace):
        body = _upload(
            client, workspace,
            [("report.pdf", b"pdf-bytes", "application/pdf")],
            path="docs",
        )
        uploaded = body["data"]["files"][0]

        # POST /v1/files would have made this uploaded_files/<stamp>_report.pdf
        assert uploaded["filename"] == "docs/report.pdf"
        assert uploaded["name"] == "report.pdf"
        assert uploaded["kind"] == "pdf"
        assert uploaded["type_group"] == "documents"
        assert body["data"]["uploaded_count"] == 1

    def test_no_path_lands_at_the_root(self, client, workspace):
        body = _upload(client, workspace, [("top.txt", b"x", "text/plain")])

        assert body["data"]["files"][0]["filename"] == "top.txt"

    def test_uploads_several_files_at_once(self, client, workspace):
        body = _upload(
            client, workspace,
            [
                ("a.txt", b"a", "text/plain"),
                ("b.png", b"b", "image/png"),
                ("c.csv", b"c", "text/csv"),
            ],
            path="batch",
        )

        assert body["data"]["uploaded_count"] == 3
        assert {f["name"] for f in body["data"]["files"]} == {"a.txt", "b.png", "c.csv"}

    def test_the_file_shows_up_in_browse(self, client, workspace):
        _upload(client, workspace, [("note.md", b"# hi", "text/markdown")], path="docs")
        data = _browse(client, workspace, path="docs")["data"]

        assert [f["name"] for f in data["files"]] == ["note.md"]

    def test_directory_parts_in_the_name_are_dropped(self, client, workspace):
        """The folder comes from `path`; a name is only ever a leaf."""
        body = _upload(
            client, workspace,
            [("../../etc/passwd", b"x", "text/plain")],
            path="docs",
        )

        assert body["data"]["files"][0]["filename"] == "docs/passwd"

    def test_rejects_an_invalid_path(self, client, workspace):
        resp = client.post(
            "/v1/files/upload",
            data={"network": workspace["id"], "path": "../escape"},
            files=[("files", ("a.txt", b"a", "text/plain"))],
            headers=_headers(workspace),
        )
        assert resp.json()["code"] == 400

    def test_requires_a_valid_token(self, client, workspace):
        resp = client.post(
            "/v1/files/upload",
            data={"network": workspace["id"]},
            files=[("files", ("a.txt", b"a", "text/plain"))],
        )
        assert resp.json()["code"] == 401

    def test_skips_a_reserved_name_and_keeps_the_rest(self, client, workspace):
        body = _upload(
            client, workspace,
            [(".keep", b"", "text/plain"), ("real.txt", b"x", "text/plain")],
            path="docs",
        )
        data = body["data"]

        assert data["uploaded_count"] == 1
        assert data["files"][0]["name"] == "real.txt"
        assert data["skipped"] == [{"filename": ".keep", "reason": "invalid_name"}]


class TestUploadConflicts:

    def test_renames_by_default(self, client, workspace):
        _upload(client, workspace, [("report.pdf", b"v1", "application/pdf")], path="docs")
        body = _upload(client, workspace, [("report.pdf", b"v2", "application/pdf")], path="docs")
        uploaded = body["data"]["files"][0]

        assert uploaded["filename"] == "docs/report (2).pdf"
        assert uploaded["renamed_from"] == "report.pdf"

    def test_renaming_counts_up(self, client, workspace):
        for _ in range(3):
            _upload(client, workspace, [("a.txt", b"x", "text/plain")], path="docs")

        names = {f["name"] for f in _browse(client, workspace, path="docs")["data"]["files"]}
        assert names == {"a.txt", "a (2).txt", "a (3).txt"}

    def test_two_files_of_the_same_name_in_one_request(self, client, workspace):
        body = _upload(
            client, workspace,
            [("dup.txt", b"1", "text/plain"), ("dup.txt", b"2", "text/plain")],
            path="docs",
        )

        assert {f["name"] for f in body["data"]["files"]} == {"dup.txt", "dup (2).txt"}

    def test_a_dotfile_keeps_its_whole_name(self, client, workspace):
        _upload(client, workspace, [(".env", b"1", "text/plain")], path="cfg")
        body = _upload(client, workspace, [(".env", b"2", "text/plain")], path="cfg")

        assert body["data"]["files"][0]["name"] == ".env (2)"

    def test_replace_soft_deletes_the_old_record(self, client, workspace):
        first = _upload(client, workspace, [("r.txt", b"v1", "text/plain")], path="docs")
        body = _upload(
            client, workspace,
            [("r.txt", b"v2", "text/plain")],
            path="docs", on_conflict="replace",
        )
        uploaded = body["data"]["files"][0]

        assert uploaded["filename"] == "docs/r.txt"
        assert uploaded["replaced"] is True
        assert uploaded["id"] != first["data"]["files"][0]["id"]
        # one live file under that name, not two
        assert [f["name"] for f in _browse(client, workspace, path="docs")["data"]["files"]] == ["r.txt"]

    def test_error_mode_skips_the_clashing_file(self, client, workspace):
        _upload(client, workspace, [("r.txt", b"v1", "text/plain")], path="docs")
        body = _upload(
            client, workspace,
            [("r.txt", b"v2", "text/plain"), ("new.txt", b"x", "text/plain")],
            path="docs", on_conflict="error",
        )
        data = body["data"]

        assert data["skipped"] == [{"filename": "r.txt", "reason": "exists"}]
        assert [f["name"] for f in data["files"]] == ["new.txt"]

    def test_rejects_an_unknown_conflict_mode(self, client, workspace):
        resp = client.post(
            "/v1/files/upload",
            data={"network": workspace["id"], "on_conflict": "merge"},
            files=[("files", ("a.txt", b"a", "text/plain"))],
            headers=_headers(workspace),
        )
        assert resp.json()["code"] == 400


# ---------------------------------------------------------------------------
# Classification — the mapping the frontend mirrors in file-utils.tsx
# ---------------------------------------------------------------------------

class TestClassification:

    @pytest.mark.parametrize("filename,content_type,kind,group", [
        ("a.pdf", "application/pdf", "pdf", "documents"),
        ("REPORT.DOCX", "application/octet-stream", "doc", "documents"),
        ("data.csv", "text/csv", "sheet", "sheets"),
        ("deck.pptx", "", "slides", "slides"),
        ("notes.md", "", "markdown", "documents"),
        ("main.py", "application/octet-stream", "code", "code"),
        ("shot.PNG", "", "image", "images"),
        ("song.mp3", "", "audio", "audio"),
        ("clip.mov", "", "video", "video"),
        ("page.html", "text/html", "web", "web"),
        ("https://example.com", "", "web", "web"),
        ("bundle.tar.gz", "", "archive", "archives"),
        ("mystery", "application/octet-stream", "unknown", "other"),
        ("noext", "image/png", "image", "images"),
    ])
    def test_kind_and_group(self, filename, content_type, kind, group):
        assert kind_for(filename, content_type) == kind
        assert group_for(filename, content_type) == group

    def test_extension_beats_content_type(self):
        """Uploads routinely arrive as octet-stream; the name is what shows."""
        assert kind_for("report.pdf", "application/octet-stream") == "pdf"

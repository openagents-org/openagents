"""Workspace totals must not be derived from the caller's filtered file page."""
from app.models import FileRecord


def _record(db, workspace, filename, size, status="active", **extra):
    db.add(FileRecord(
        workspace_id=workspace["id"], filename=filename, size=size,
        content_type="text/plain", storage_key=f"test/{filename}",
        uploaded_by="human:user", status=status, **extra,
    ))
    db.commit()


def _list(client, workspace, suffix="", headers=None):
    return client.get(
        f"/v1/files?network={workspace['id']}{suffix}",
        headers=headers or {"X-Workspace-Token": workspace["token"]},
    ).json()


def test_storage_counts_all_files_and_trash_independently_of_paging_and_filter(client, db, workspace):
    _record(db, workspace, "a.txt", 120, channel_name="channel-a")
    _record(db, workspace, "private.txt", 300, owner="human:someone@example.com", visibility="private")
    _record(db, workspace, "deleted.txt", 80, status="deleted")
    result = _list(client, workspace, "&channel_name=channel-a&limit=1")["data"]
    assert result["total"] == 1
    assert result["storage"] == {
        "used_bytes": 500, "active_bytes": 420, "trash_bytes": 80, "limit_bytes": None,
    }
    assert "storage" not in _list(client, workspace, "&offset=1")["data"]


def test_storage_empty_workspace_and_no_credentials(client, workspace):
    assert _list(client, workspace)["data"]["storage"]["used_bytes"] == 0
    denied = _list(client, workspace, headers={"X-Workspace-Token": "wrong-token"})
    assert denied["code"] != 0
    assert "storage" not in (denied.get("data") or {})


def test_storage_does_not_include_other_workspaces(client, db, workspace):
    other = client.post("/v1/workspaces", json={"name": "Other", "agent_name": "other-agent"}).json()["data"]
    _record(db, {"id": other["workspaceId"]}, "other.txt", 999)
    _record(db, workspace, "mine.txt", 17)
    assert _list(client, workspace)["data"]["storage"]["used_bytes"] == 17

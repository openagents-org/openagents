"""POST /v1/browser/tabs/{tab_id}/upload — attach files to a page's file input.

Covers inline base64 files, workspace shared files (by file_id), validation,
size cap, Browser Fabric error mapping, and the manager forwarding to BF's
`upload_file` tool with the tab's existing session.
"""

import asyncio
import base64
from unittest.mock import AsyncMock, MagicMock, patch

from app.browser import BrowserManager
from tests.test_browser_tab_leak import _create_workspace, _mock_cloud_manager, _open_tab, _patch_manager_cls

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _setup(client, MockManager):
    ws = _create_workspace(client)
    manager = _mock_cloud_manager()
    manager.upload_files = AsyncMock(return_value={"status": "attached", "file_count": 1, "total_bytes": len(PNG)})
    _patch_manager_cls(MockManager, manager)
    tab_id = _open_tab(client, ws).json()["data"]["id"]
    return ws, manager, tab_id


def _upload(client, ws, tab_id, body):
    return client.post(f"/v1/browser/tabs/{tab_id}/upload", json=body,
                       headers={"X-Workspace-Token": ws["token"]})


@patch("app.routers.browser._ensure_connected", new_callable=AsyncMock)
@patch("app.routers.browser.BrowserManager")
def test_inline_base64_upload(MockManager, _ens, client):
    ws, manager, tab_id = _setup(client, MockManager)
    resp = _upload(client, ws, tab_id, {
        "selector": "input[type=file]",
        "files": [{"name": "hero.png", "mime_type": "image/png", "data_base64": base64.b64encode(PNG).decode()}],
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["status"] == "attached" and data["files"] == ["hero.png"]
    args = manager.upload_files.await_args.args
    assert args[0] == tab_id and args[1] == "input[type=file]" and args[3] is None
    sent = args[2][0]
    assert sent["name"] == "hero.png" and sent["mime_type"] == "image/png"
    assert base64.b64decode(sent["data_base64"]) == PNG


@patch("app.routers.browser._ensure_connected", new_callable=AsyncMock)
@patch("app.routers.browser.BrowserManager")
def test_upload_from_workspace_file(MockManager, _ens, client):
    ws, manager, tab_id = _setup(client, MockManager)
    up = client.post("/v1/files/base64", headers={"X-Workspace-Token": ws["token"]}, json={
        "filename": "pilot-program-hero.png", "content_base64": base64.b64encode(PNG).decode(),
        "content_type": "image/png", "network": ws["id"], "source": "openagents:agent-leak",
    })
    assert up.status_code == 200, up.text
    file_id = up.json()["data"]["id"]
    resp = _upload(client, ws, tab_id, {"files": [{"file_id": file_id}], "frame_selector": "iframe#editor"})
    assert resp.status_code == 200, resp.text
    args = manager.upload_files.await_args.args
    assert args[1] == "input[type=file]"  # default selector
    assert args[3] == "iframe#editor"
    sent = args[2][0]
    assert sent["name"] == "pilot-program-hero.png" and sent["mime_type"] == "image/png"
    assert base64.b64decode(sent["data_base64"]) == PNG


@patch("app.routers.browser._ensure_connected", new_callable=AsyncMock)
@patch("app.routers.browser.BrowserManager")
def test_unknown_file_id_and_bad_items_are_400(MockManager, _ens, client):
    ws, manager, tab_id = _setup(client, MockManager)
    assert _upload(client, ws, tab_id, {"files": [{"file_id": "nope"}]}).status_code == 400
    assert _upload(client, ws, tab_id, {"files": [{"name": "x.png"}]}).status_code == 400
    assert _upload(client, ws, tab_id, {"files": [{"name": "x.png", "data_base64": "!!notb64"}]}).status_code == 400
    assert _upload(client, ws, tab_id, {"files": []}).status_code in (400, 422)
    manager.upload_files.assert_not_awaited()


@patch("app.routers.browser._ensure_connected", new_callable=AsyncMock)
@patch("app.routers.browser.BrowserManager")
def test_size_cap(MockManager, _ens, client):
    ws, manager, tab_id = _setup(client, MockManager)
    big = base64.b64encode(b"\0" * (10 * 1024 * 1024 + 1)).decode()
    resp = _upload(client, ws, tab_id, {"files": [{"name": "big.bin", "data_base64": big}]})
    assert resp.status_code == 400 and "10 MiB" in resp.json()["message"]
    manager.upload_files.assert_not_awaited()


@patch("app.routers.browser._ensure_connected", new_callable=AsyncMock)
@patch("app.routers.browser.BrowserManager")
def test_bf_error_maps_to_400(MockManager, _ens, client):
    ws, manager, tab_id = _setup(client, MockManager)
    manager.upload_files = AsyncMock(side_effect=RuntimeError("Browser Fabric error: file_input_not_found"))
    resp = _upload(client, ws, tab_id, {"files": [{"name": "a.png", "data_base64": base64.b64encode(PNG).decode()}]})
    assert resp.status_code == 400 and "file_input_not_found" in resp.json()["message"]


@patch("app.routers.browser.BrowserManager")
def test_wrong_token_is_401(MockManager, client):
    ws, manager, tab_id = _setup(client, MockManager)
    resp = client.post(f"/v1/browser/tabs/{tab_id}/upload", headers={"X-Workspace-Token": "wrong"},
                       json={"files": [{"name": "a.png", "data_base64": base64.b64encode(PNG).decode()}]})
    assert resp.status_code in (401, 403)
    manager.upload_files.assert_not_awaited()


def test_manager_forwards_to_bf_upload_file():
    mgr = BrowserManager()
    mgr._sessions["tab-1"] = "sess-9"
    mgr._bf_call = AsyncMock(return_value={"success": True, "result": {"status": "attached", "file_count": 1, "total_bytes": 67}})
    files = [{"name": "a.png", "mime_type": "image/png", "data_base64": "AAAA"}]
    out = asyncio.run(mgr.upload_files("tab-1", "input[type=file]", files, "iframe#x"))
    assert out["status"] == "attached"
    name, args, sid = mgr._bf_call.await_args.args[:3]
    assert name == "upload_file" and sid == "sess-9"
    assert args == {"selector": "input[type=file]", "files": files, "frame_selector": "iframe#x"}

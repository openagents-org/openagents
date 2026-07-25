# -*- coding: utf-8 -*-
"""
Tests for image search (POST /v1/search/images) and URL file ingestion
(POST /v1/files/from_url) including post_to_channel attachment messages.

Brave Search and the file download are mocked.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select

from app.models import EventRecord, FileRecord
from tests.conftest import TestingSessionLocal

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 100


def _create_workspace(client):
    resp = client.post("/v1/workspaces", json={
        "name": "Image Test Workspace",
        "agent_name": "agent-image",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    channel = data["channel"]
    channel_name = channel["name"] if isinstance(channel, dict) else channel
    return {"id": data["workspaceId"], "token": data["token"], "channel": channel_name}


BRAVE_RESULTS = [
    {
        "title": "Golden Gate at sunset",
        "url": "https://photos.example.com/page1",
        "source": "photos.example.com",
        "thumbnail": {"src": "https://thumbs.example.com/1.jpg"},
        "properties": {"url": "https://images.example.com/1.jpg", "width": 1920, "height": 1080},
    },
    {
        "title": "No image url — skipped",
        "url": "https://photos.example.com/page2",
        "thumbnail": {},
        "properties": {},
    },
]


class TestImageSearch:

    @patch("app.routers.search._brave_image_search", new_callable=AsyncMock)
    @patch.dict("os.environ", {"BRAVE_SEARCH_API_KEY": "test-key"})
    def test_search_returns_mapped_results(self, mock_search, client):
        mock_search.return_value = [
            {
                "title": "Golden Gate at sunset",
                "image_url": "https://images.example.com/1.jpg",
                "thumbnail_url": "https://thumbs.example.com/1.jpg",
                "page_url": "https://photos.example.com/page1",
                "source": "photos.example.com",
                "width": 1920,
                "height": 1080,
            },
        ]
        workspace = _create_workspace(client)
        resp = client.post("/v1/search/images", json={
            "query": "golden gate",
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["total"] == 1
        assert data["results"][0]["image_url"] == "https://images.example.com/1.jpg"

    def test_search_without_key_returns_config_error(self, client):
        workspace = _create_workspace(client)
        with patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("BRAVE_SEARCH_API_KEY", None)
            resp = client.post("/v1/search/images", json={
                "query": "anything",
                "network": workspace["id"],
            }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 400
        body = resp.json()
        assert body["data"]["error_code"] == "SEARCH_NOT_CONFIGURED"
        assert "hint" in body["data"]

    def test_brave_result_mapping_skips_items_without_image(self):
        import asyncio
        from app.routers import search as search_mod

        response = MagicMock()
        response.json.return_value = {"results": BRAVE_RESULTS}
        response.raise_for_status.return_value = None

        client_cm = MagicMock()
        client_cm.__aenter__ = AsyncMock(return_value=client_cm)
        client_cm.__aexit__ = AsyncMock(return_value=False)
        client_cm.get = AsyncMock(return_value=response)

        with patch.object(search_mod.httpx, "AsyncClient", return_value=client_cm):
            results = asyncio.run(search_mod._brave_image_search("k", "q", 10, "strict"))

        assert len(results) == 1
        assert results[0]["image_url"] == "https://images.example.com/1.jpg"
        assert results[0]["width"] == 1920


def _fake_result(content=PNG_BYTES, content_type="image/png", status=200, final_url="https://images.example.com/pic.png"):
    from app.net_security import SafeFetchResult
    return SafeFetchResult(
        content=content,
        status_code=status,
        headers={"content-type": content_type},
        final_url=final_url,
        truncated=False,
    )


def _patch_safe_fetch(result):
    from app.routers import files as files_mod
    return patch.object(files_mod, "safe_fetch", new=AsyncMock(return_value=result))


class TestFromUrl:

    def test_from_url_saves_file(self, client):
        workspace = _create_workspace(client)
        with _patch_safe_fetch(_fake_result()):
            resp = client.post("/v1/files/from_url", json={
                "url": "https://images.example.com/pic.png",
                "network": workspace["id"],
                "source": "openagents:agent-image",
                "channel_name": workspace["channel"],
            }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200, resp.json()
        data = resp.json()["data"]
        assert data["content_type"] == "image/png"
        assert data["posted_to_channel"] is False

        db = TestingSessionLocal()
        record = db.get(FileRecord, data["id"])
        assert record is not None and record.size == len(PNG_BYTES)
        db.close()

    def test_from_url_post_to_channel_emits_attachment_message(self, client):
        workspace = _create_workspace(client)
        with _patch_safe_fetch(_fake_result()):
            resp = client.post("/v1/files/from_url", json={
                "url": "https://images.example.com/pic.png",
                "network": workspace["id"],
                "source": "openagents:agent-image",
                "channel_name": workspace["channel"],
                "post_to_channel": True,
                "caption": "剧照来了",
            }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200, resp.json()
        data = resp.json()["data"]
        assert data["posted_to_channel"] is True

        db = TestingSessionLocal()
        events = db.execute(
            select(EventRecord).where(EventRecord.type == "workspace.message.posted")
        ).scalars().all()
        message_events = [e for e in events if (e.payload or {}).get("attachments")]
        assert len(message_events) == 1
        attachment = message_events[0].payload["attachments"][0]
        assert attachment["file_id"] == data["id"]
        assert attachment["content_type"] == "image/png"
        assert message_events[0].payload["content"] == "剧照来了"
        db.close()

    def test_from_url_rejects_html_pages(self, client):
        workspace = _create_workspace(client)
        result = _fake_result(content=b"<html>a page</html>", content_type="text/html; charset=utf-8")
        with _patch_safe_fetch(result):
            resp = client.post("/v1/files/from_url", json={
                "url": "https://example.com/page",
                "network": workspace["id"],
            }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "NOT_A_FILE"

    def test_from_url_blocks_ssrf_without_mock(self, client):
        # safe_fetch runs for real; an internal IP literal is blocked before
        # any socket is opened (no DNS, no network).
        workspace = _create_workspace(client)
        resp = client.post("/v1/files/from_url", json={
            "url": "http://169.254.169.254/latest/meta-data/",
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "BLOCKED_PRIVATE_ADDRESS"

    def test_from_url_rejects_non_http(self, client):
        workspace = _create_workspace(client)
        resp = client.post("/v1/files/from_url", json={
            "url": "ftp://example.com/file.png",
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "UNSUPPORTED_SCHEME"


class TestBase64PostToChannel:

    def test_base64_upload_with_post_to_channel(self, client):
        import base64
        workspace = _create_workspace(client)
        resp = client.post("/v1/files/base64", json={
            "filename": "chart.png",
            "content_base64": base64.b64encode(PNG_BYTES).decode(),
            "content_type": "image/png",
            "network": workspace["id"],
            "channel_name": workspace["channel"],
            "source": "openagents:agent-image",
            "post_to_channel": True,
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200, resp.json()
        assert resp.json()["data"]["posted_to_channel"] is True


# ---------------------------------------------------------------------------
# Download hardening: no inline SVG/HTML (stored XSS), nosniff always set
# ---------------------------------------------------------------------------

class TestDownloadDisposition:

    def _upload(self, client, workspace, filename, content_type, data=PNG_BYTES):
        import base64
        resp = client.post("/v1/files/base64", json={
            "filename": filename,
            "content_base64": base64.b64encode(data).decode(),
            "content_type": content_type,
            "network": workspace["id"],
            "source": "openagents:agent-image",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200, resp.json()
        return resp.json()["data"]["id"]

    def _download(self, client, workspace, file_id):
        return client.get(f"/v1/files/{file_id}",
                          headers={"X-Workspace-Token": workspace["token"]})

    def test_png_served_inline_with_nosniff(self, client):
        workspace = _create_workspace(client)
        fid = self._upload(client, workspace, "pic.png", "image/png")
        resp = self._download(client, workspace, fid)
        assert resp.status_code == 200
        assert resp.headers["content-disposition"].startswith("inline")
        assert resp.headers["x-content-type-options"] == "nosniff"

    def test_svg_forced_to_attachment(self, client):
        workspace = _create_workspace(client)
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        fid = self._upload(client, workspace, "x.svg", "image/svg+xml", data=svg)
        resp = self._download(client, workspace, fid)
        assert resp.status_code == 200
        # SVG must NOT render inline (scriptable) — served as a download.
        assert resp.headers["content-disposition"].startswith("attachment")
        assert resp.headers["x-content-type-options"] == "nosniff"

    def test_html_forced_to_attachment(self, client):
        workspace = _create_workspace(client)
        html = b"<html><body><script>alert(1)</script></body></html>"
        fid = self._upload(client, workspace, "x.html", "text/html", data=html)
        resp = self._download(client, workspace, fid)
        assert resp.status_code == 200
        assert resp.headers["content-disposition"].startswith("attachment")


# ---------------------------------------------------------------------------
# Secrets must not leak through the workspace settings response
# ---------------------------------------------------------------------------

class TestSettingsRedaction:

    def test_secret_keys_stripped_from_settings(self, client):
        workspace = _create_workspace(client)
        # Store secrets in settings via PATCH
        resp = client.patch(f"/v1/workspaces/{workspace['id']}", json={
            "settings": {
                "browser_enabled": True,
                "browserfabric_api_key": "bf-secret-123456789",
                "brave_search_api_key": "brave-secret-abc",
                "some_token": "tok-xyz",
                "public_pref": "keep-me",
            },
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200, resp.json()
        settings = resp.json()["data"]["settings"]
        assert "browserfabric_api_key" not in settings
        assert "brave_search_api_key" not in settings
        assert "some_token" not in settings
        assert settings.get("public_pref") == "keep-me"
        assert settings.get("browser_enabled") is True
        # The masked BF key is still surfaced as its own field (not raw)
        assert "..." in (resp.json()["data"]["browserfabricApiKey"] or "")

    def test_settings_patch_merges_and_preserves_secrets(self, client):
        # Redaction strips secrets from responses, so a read-modify-write of
        # settings must NOT drop the stored BF/Brave keys — PATCH merges.
        workspace = _create_workspace(client)
        # 1. store a secret + a public pref
        r1 = client.patch(f"/v1/workspaces/{workspace['id']}", json={
            "settings": {"browserfabric_api_key": "bf-secret-123456789", "theme": "dark"},
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert r1.status_code == 200
        assert "browserfabric_api_key" not in r1.json()["data"]["settings"]  # redacted

        # 2. simulate the frontend RMW: write back redacted settings + one change
        redacted = r1.json()["data"]["settings"]
        r2 = client.patch(f"/v1/workspaces/{workspace['id']}", json={
            "settings": {**redacted, "monitorMode": True},
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert r2.status_code == 200

        # 3. the BF key must survive (masked field still present), plus new prefs
        assert "..." in (r2.json()["data"]["browserfabricApiKey"] or "")
        assert r2.json()["data"]["settings"].get("monitorMode") is True
        assert r2.json()["data"]["settings"].get("theme") == "dark"

    def test_settings_patch_can_delete_key_with_null(self, client):
        workspace = _create_workspace(client)
        client.patch(f"/v1/workspaces/{workspace['id']}", json={
            "settings": {"theme": "dark"},
        }, headers={"X-Workspace-Token": workspace["token"]})
        r = client.patch(f"/v1/workspaces/{workspace['id']}", json={
            "settings": {"theme": None},
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert r.status_code == 200
        assert "theme" not in r.json()["data"]["settings"]

# -*- coding: utf-8 -*-
"""Tests for user avatars: upload pipeline, capability URLs, and the
transactional deletion outbox.

Identity-token verification is stubbed the same way test_workspace_membership
does it — by patching app.access.verify_identity_claims, which every caller
routes through.
"""

import io

import pytest
from PIL import Image

import app.access as access
import app.routers.account as account_router
import app.storage as storage_mod
from app.blob_gc import drain_blob_deletions
from app.models import BlobDeletion, User, Workspace, WorkspaceMembership
from app.storage import LocalFileStore


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def local_store(tmp_path, monkeypatch):
    """Point the FileStore singleton at a temp dir for the whole module."""
    store = LocalFileStore(base_dir=str(tmp_path / "blobs"))
    monkeypatch.setattr(storage_mod, "_store", store)
    return store


def _claims(email, uid="uid", name="Test User"):
    return {"provider": "firebase", "email": email, "firebase_uid": uid,
            "apple_sub": None, "display_name": name}


@pytest.fixture(autouse=True)
def stub_identity(monkeypatch):
    """Bearer "<name>" resolves to <name>@example.com.

    Two seams, because DELETE /v1/account predates `resolve_current_user` and
    still verifies the bearer itself via `verify_identity_token`.
    """
    monkeypatch.setattr(
        access, "verify_identity_claims",
        lambda tok: _claims(f"{tok}@example.com", uid=tok, name=tok.title()) if tok else None,
    )
    monkeypatch.setattr(
        account_router, "verify_identity_token",
        lambda tok: f"{tok}@example.com" if tok else None,
    )


def _auth(name):
    return {"Authorization": f"Bearer {name}"}


def _png(width=64, height=64, color=(200, 30, 30), mode="RGB"):
    img = Image.new(mode, (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_with_orientation(orientation: int, width=100, height=40):
    """A landscape JPEG carrying an EXIF orientation tag that means "rotate".

    Orientation 6 says the camera was held rotated, so a correct renderer shows
    it as portrait. We start from a wide image so the un-rotated and rotated
    interpretations are distinguishable.
    """
    img = Image.new("RGB", (width, height), (10, 120, 200))
    exif = img.getexif()
    exif[0x0112] = orientation
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def _upload(client, who, data, filename="a.png", content_type="image/png"):
    return client.post(
        "/v1/account/avatar",
        files={"file": (filename, data, content_type)},
        headers=_auth(who),
    )


# ---------------------------------------------------------------------------
# Upload + read round trip
# ---------------------------------------------------------------------------

class TestUploadAndRead:
    def test_upload_returns_a_readable_url(self, client):
        r = _upload(client, "alice", _png())
        assert r.status_code == 200
        url = r.json()["data"]["avatarUrl"]
        assert url.startswith("/v1/avatars/")

        got = client.get(url)
        assert got.status_code == 200
        assert got.headers["content-type"] == "image/webp"
        # Always re-encoded, never passed through.
        assert got.content[:4] == b"RIFF" and got.content[8:12] == b"WEBP"

    def test_output_is_square_and_normalized(self, client):
        r = _upload(client, "alice", _png(width=200, height=80))
        url = r.json()["data"]["avatarUrl"]
        img = Image.open(io.BytesIO(client.get(url).content))
        assert img.size == (512, 512)

    def test_upload_requires_identity(self, client):
        r = client.post("/v1/account/avatar", files={"file": ("a.png", _png(), "image/png")})
        assert r.status_code == 401

    def test_read_needs_no_credentials(self, client):
        """The URL is the capability — that's the whole point of the design."""
        url = _upload(client, "alice", _png()).json()["data"]["avatarUrl"]
        assert client.get(url).status_code == 200

    def test_grayscale_and_palette_images_are_accepted(self, client):
        for mode in ("L", "P"):
            data = _png(mode=mode, color=128 if mode == "L" else 3)
            assert _upload(client, "alice", data).status_code == 200


# ---------------------------------------------------------------------------
# The pipeline is a security boundary, not a resize
# ---------------------------------------------------------------------------

class TestRejections:
    def test_svg_is_rejected(self, client):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        r = _upload(client, "alice", svg, filename="x.svg", content_type="image/svg+xml")
        assert r.status_code == 400

    def test_content_type_is_not_trusted(self, client):
        """Text claiming to be a PNG is still text."""
        r = _upload(client, "alice", b"not an image at all", content_type="image/png")
        assert r.status_code == 400

    def test_oversized_upload_is_rejected(self, client, monkeypatch):
        from app.config import config
        monkeypatch.setattr(config, "AVATAR_MAX_UPLOAD_SIZE", 1024)
        r = _upload(client, "alice", _png(width=800, height=800))
        assert r.status_code == 413

    def test_decompression_bomb_is_rejected(self, client, monkeypatch):
        """Pixel count is checked from the header, before any pixel work."""
        from app.config import config
        monkeypatch.setattr(config, "AVATAR_MAX_PIXELS", 1000)
        r = _upload(client, "alice", _png(width=200, height=200))
        assert r.status_code == 400

    def test_truncated_image_is_a_400_not_a_500(self, client):
        data = _png(width=300, height=300)
        r = _upload(client, "alice", data[: len(data) // 2])
        assert r.status_code == 400

    def test_empty_upload_is_rejected(self, client):
        assert _upload(client, "alice", b"").status_code == 400


class TestExifOrientation:
    def test_orientation_is_applied_before_cropping(self, client):
        """A phone's portrait photo is stored landscape plus an orientation tag.

        Re-encoding drops the tag, so if the rotation isn't baked in first the
        avatar ends up rotated and cropped along the wrong axis. Compare against
        what Pillow itself produces for the transposed image.
        """
        raw = _jpeg_with_orientation(6, width=100, height=40)
        url = _upload(client, "alice", raw, filename="p.jpg", content_type="image/jpeg").json()["data"]["avatarUrl"]
        served = Image.open(io.BytesIO(client.get(url).content))

        from PIL import ImageOps
        expected = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        # Orientation 6 turns a 100x40 landscape into a 40x100 portrait.
        assert expected.size == (40, 100)
        assert served.size == (512, 512)


# ---------------------------------------------------------------------------
# Replacement, removal, and the deletion outbox
# ---------------------------------------------------------------------------

class TestLifecycle:
    def test_replacing_deletes_the_old_blob(self, client, local_store):
        first = _upload(client, "alice", _png(color=(255, 0, 0))).json()["data"]["avatarUrl"]
        assert client.get(first).status_code == 200

        second = _upload(client, "alice", _png(color=(0, 255, 0))).json()["data"]["avatarUrl"]
        assert second != first
        assert client.get(second).status_code == 200
        assert client.get(first).status_code == 404

    def test_concurrent_uploads_never_orphan_the_pointer(self, client, db):
        """Two uploads in a row must leave the DB pointing at bytes that exist.

        Random blob ids are what make this safe: with content-addressed keys, a
        user re-uploading the same image would produce a key equal to the one
        being deleted.
        """
        same = _png(color=(7, 7, 7))
        _upload(client, "alice", same)
        url = _upload(client, "alice", same).json()["data"]["avatarUrl"]

        user = db.query(User).filter(User.email == "alice@example.com").one()
        assert user.avatar_key is not None
        assert client.get(url).status_code == 200

    def test_removing_clears_the_pointer_and_the_bytes(self, client, db):
        url = _upload(client, "alice", _png()).json()["data"]["avatarUrl"]
        r = client.delete("/v1/account/avatar", headers=_auth("alice"))
        assert r.status_code == 200
        assert r.json()["data"]["avatarUrl"] is None
        assert client.get(url).status_code == 404

        db.expire_all()
        assert db.query(User).filter(User.email == "alice@example.com").one().avatar_key is None

    def test_remove_is_idempotent(self, client):
        _upload(client, "alice", _png())
        assert client.delete("/v1/account/avatar", headers=_auth("alice")).status_code == 200
        assert client.delete("/v1/account/avatar", headers=_auth("alice")).status_code == 200


class TestDeletionOutbox:
    def test_failed_delete_still_succeeds_and_is_recorded(self, client, db, monkeypatch, local_store):
        """A storage failure must not fail the user's request — but it must not
        vanish either. That's the whole reason the outbox exists."""
        _upload(client, "alice", _png(color=(1, 2, 3)))

        def boom(key):
            raise RuntimeError("S3 unavailable")

        monkeypatch.setattr(local_store, "delete", boom)
        r = _upload(client, "alice", _png(color=(4, 5, 6)))
        assert r.status_code == 200

        db.expire_all()
        pending = db.query(BlobDeletion).all()
        assert len(pending) == 1
        assert pending[0].storage_key.startswith("avatars/")

    def test_drainer_removes_the_blob_and_the_row(self, client, db, monkeypatch, local_store):
        first = _upload(client, "alice", _png(color=(1, 2, 3))).json()["data"]["avatarUrl"]

        monkeypatch.setattr(local_store, "delete", lambda key: (_ for _ in ()).throw(RuntimeError("down")))
        _upload(client, "alice", _png(color=(4, 5, 6)))
        monkeypatch.undo()

        db.expire_all()
        assert db.query(BlobDeletion).count() == 1
        assert drain_blob_deletions(db) == 1

        db.expire_all()
        assert db.query(BlobDeletion).count() == 0
        assert client.get(first).status_code == 404

    def test_drainer_is_idempotent_for_missing_blobs(self, db):
        db.add(BlobDeletion(storage_key="avatars/nobody/deadbeef.webp"))
        db.commit()
        # LocalFileStore.delete on a missing path is a no-op, so the row clears.
        assert drain_blob_deletions(db) == 1

    def test_failed_attempts_back_off_rather_than_retrying_hot(self, db, monkeypatch, local_store):
        db.add(BlobDeletion(storage_key="avatars/x/y.webp"))
        db.commit()
        monkeypatch.setattr(local_store, "delete", lambda key: (_ for _ in ()).throw(RuntimeError("down")))

        assert drain_blob_deletions(db) == 0
        db.expire_all()
        row = db.query(BlobDeletion).one()
        assert row.attempts == 1
        assert row.last_error
        # Rescheduled into the future, so the next cycle doesn't hammer storage.
        assert drain_blob_deletions(db) == 0


# ---------------------------------------------------------------------------
# HTTP semantics
# ---------------------------------------------------------------------------

class TestCachingAndPaths:
    def test_cache_is_private_and_revocable(self, client):
        """`immutable` plus a long max-age would mean "can never be withdrawn"."""
        url = _upload(client, "alice", _png()).json()["data"]["avatarUrl"]
        cc = client.get(url).headers["cache-control"]
        assert "private" in cc
        assert "immutable" not in cc

    def test_if_none_match_returns_304(self, client):
        url = _upload(client, "alice", _png()).json()["data"]["avatarUrl"]
        etag = client.get(url).headers["etag"]
        assert client.get(url, headers={"If-None-Match": etag}).status_code == 304

    def test_nosniff_is_set(self, client):
        url = _upload(client, "alice", _png()).json()["data"]["avatarUrl"]
        assert client.get(url).headers["x-content-type-options"] == "nosniff"

    @pytest.mark.parametrize("path", [
        "/v1/avatars/not-a-uuid/00000000000000000000000000000000.webp",
        "/v1/avatars/11111111-1111-1111-1111-111111111111/short.webp",
        "/v1/avatars/11111111-1111-1111-1111-111111111111/../../etc/passwd",
        "/v1/avatars/11111111-1111-1111-1111-111111111111/abc.txt",
    ])
    def test_malformed_paths_are_404_not_500(self, client, path):
        assert client.get(path).status_code == 404


# ---------------------------------------------------------------------------
# Identity plumbing — profile endpoint and the team roster
# ---------------------------------------------------------------------------

class TestProfile:
    def test_profile_returns_a_stable_user_id(self, client):
        r = client.get("/v1/account/profile", headers=_auth("alice"))
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["email"] == "alice@example.com"
        assert data["userId"]
        assert data["avatarUrl"] is None

        _upload(client, "alice", _png())
        assert client.get("/v1/account/profile", headers=_auth("alice")).json()["data"]["avatarUrl"]

    def test_profile_requires_identity(self, client):
        assert client.get("/v1/account/profile").status_code == 401

    def test_account_workspaces_still_returns_a_bare_array(self, client):
        """Three clients index this response directly — Swift decodes it as
        [AccountWorkspace]. It must stay an array."""
        r = client.get("/v1/account/workspaces", headers=_auth("alice"))
        assert r.status_code == 200
        data = r.json()["data"]
        assert isinstance(data, list)
        if data:
            assert set(data[0]) == {"workspaceId", "name", "slug", "token", "role", "lastActivityAt"}


class TestTeamAvatarGating:
    def _workspace_with_member(self, client, db, *, open_workspace=False):
        ws = Workspace(
            name="W", slug="team-ws",
            password_hash=None if open_workspace else "tok",
            require_login=False,
        )
        db.add(ws)
        db.flush()
        user = User(email="alice@example.com", display_name="Alice")
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=ws.id, user_id=user.id, role="owner"))
        db.commit()
        return ws, user

    def test_identified_member_sees_avatar_urls(self, client, db):
        ws, _ = self._workspace_with_member(client, db)
        _upload(client, "alice", _png())

        r = client.get(f"/v1/workspaces/{ws.id}/team", headers=_auth("alice"))
        assert r.status_code == 200
        row = r.json()["data"][0]
        assert row["userId"]
        assert row["avatarUrl"]

    def test_machine_token_caller_gets_no_avatar_urls(self, client, db):
        """A workspace token proves access, not identity — and it's exactly the
        credential viewers are denied. It shouldn't hand out capabilities."""
        ws, _ = self._workspace_with_member(client, db)
        _upload(client, "alice", _png())

        r = client.get(f"/v1/workspaces/{ws.id}/team", headers={"X-Workspace-Token": "tok"})
        assert r.status_code == 200
        assert r.json()["data"][0]["avatarUrl"] is None

    def test_anonymous_read_of_an_open_workspace_gets_no_avatar_urls(self, client, db):
        """Open workspaces are waved through by verify_workspace_access, so the
        roster is anonymously readable. The avatar URLs must not be."""
        ws, _ = self._workspace_with_member(client, db, open_workspace=True)
        _upload(client, "alice", _png())

        r = client.get(f"/v1/workspaces/{ws.id}/team")
        assert r.status_code == 200
        assert r.json()["data"][0]["avatarUrl"] is None


class TestAccountDeletion:
    def test_deleting_the_account_removes_the_avatar(self, client, db):
        url = _upload(client, "alice", _png()).json()["data"]["avatarUrl"]
        assert client.get(url).status_code == 200

        r = client.delete("/v1/account", headers=_auth("alice"))
        assert r.status_code == 200
        assert r.json()["data"]["deleted"]["avatar"] == 1

        assert client.get(url).status_code == 404
        db.expire_all()
        assert db.query(User).filter(User.email == "alice@example.com").one().avatar_key is None

    def test_deleting_without_an_avatar_is_fine(self, client):
        r = client.delete("/v1/account", headers=_auth("bob"))
        assert r.status_code == 200
        assert r.json()["data"]["deleted"]["avatar"] == 0

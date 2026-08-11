# -*- coding: utf-8 -*-
"""
User avatar endpoints.

POST   /v1/account/avatar                       Upload (identity bearer)
DELETE /v1/account/avatar                       Remove (identity bearer)
GET    /v1/avatars/{user_id}/{blob_id}.webp     Read (no auth — see below)

**Why the read path takes no credential.** An <img> tag can't send an
Authorization header, so the bytes have to be reachable from a plain URL. The
file download endpoint solves that with `?token=<workspace token>`, which is
wrong here: that token is fully trusted by `verify_workspace_access` and
bypasses role checks, and `/v1/account/workspaces` deliberately withholds it
from viewers. Putting it in an <img src> would hand every viewer a credential
the system is careful not to give them.

So the URL *is* the capability: a 128-bit random `blob_id` that only ever
appears in authenticated responses. Revocation is real but not instant —
deleting the blob 404s the URL immediately, while a viewer who already fetched
it keeps their cached copy until `AVATAR_CACHE_MAX_AGE` expires. That window is
why the response is `private` and not `immutable`.

The bytes are read through `FileStore` and served from here, never redirected to
a presigned S3 URL — same as `/v1/files/{id}`. Which backend holds them stays
invisible to clients.
"""

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Header, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.access import resolve_current_user
from app.avatar import AvatarError, new_blob_id, process_avatar, read_upload_limited, storage_key
from app.blob_gc import enqueue_deletion, try_delete_now
from app.config import config
from app.database import get_db
from app.response import ResponseCode, json_response, success_response
from app.storage import get_file_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Avatars"])

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_BLOB_RE = re.compile(r"^[a-f0-9]{32}$")


def avatar_url(user_id: str, avatar_key: Optional[str]) -> Optional[str]:
    """Public URL path for a stored avatar key, or None if there isn't one.

    Returns a path, not an absolute URL — the backend doesn't reliably know its
    own public origin, and every client already knows the API base.
    """
    if not avatar_key:
        return None
    blob = avatar_key.rsplit("/", 1)[-1]
    return f"/v1/avatars/{user_id}/{blob}"


# ---------------------------------------------------------------------------
# POST /v1/account/avatar
# ---------------------------------------------------------------------------

@router.post("/account/avatar")
async def upload_avatar(
    file: UploadFile = File(..., description="Image file (JPEG, PNG, GIF or WebP)"),
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Replace the signed-in user's avatar.

    Takes no workspace parameter on purpose: an avatar belongs to the user
    across every workspace they're in, not to any one of them.

    Ordering is write-new, then commit, then delete-old, and never the reverse.
    If this fails partway the worst outcome is an unreferenced blob; deleting
    first would mean a broken avatar. The old key is enqueued for deletion in
    the same transaction as the pointer swap, so an S3 failure can't lose it.
    """
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")

    try:
        raw = await read_upload_limited(file, config.AVATAR_MAX_UPLOAD_SIZE)
        processed = await process_avatar(raw)
    except AvatarError as exc:
        return json_response(ResponseCode.BAD_REQUEST, exc.message, status_code=exc.status)

    blob_id = new_blob_id()
    store = get_file_store()

    # 1. New bytes first. The DB still points at the old avatar, so a failure
    #    here leaves the user exactly as they were. Trust the key the store
    #    hands back rather than rebuilding it, so the two can't drift.
    try:
        key = await asyncio.to_thread(
            store.save, "avatars", str(user.id), f"{blob_id}.webp", processed
        )
    except Exception:
        logger.exception("avatar: failed to store blob for user %s", user.id)
        return json_response(ResponseCode.INTERNAL_ERROR, "Could not save the image")

    # 2. Swap the pointer and record the old key for deletion — one transaction.
    old_key = user.avatar_key
    user.avatar_key = key
    user.avatar_updated_at = datetime.now(timezone.utc)
    enqueue_deletion(db, old_key)
    db.commit()

    # 3. Now that the intent is durable, try the delete immediately; the drainer
    #    handles it if this doesn't land.
    try_delete_now(db, old_key)

    return success_response({
        "userId": str(user.id),
        "avatarUrl": avatar_url(str(user.id), key),
    })


# ---------------------------------------------------------------------------
# DELETE /v1/account/avatar
# ---------------------------------------------------------------------------

@router.delete("/account/avatar")
def delete_avatar(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Remove the signed-in user's avatar. Idempotent."""
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")

    old_key = user.avatar_key
    user.avatar_key = None
    user.avatar_updated_at = datetime.now(timezone.utc)
    enqueue_deletion(db, old_key)
    db.commit()

    try_delete_now(db, old_key)

    return success_response({"userId": str(user.id), "avatarUrl": None})


# ---------------------------------------------------------------------------
# GET /v1/avatars/{user_id}/{filename}
# ---------------------------------------------------------------------------

@router.get("/avatars/{user_id}/{filename}")
async def get_avatar(user_id: str, filename: str, request: Request):
    """Serve avatar bytes. No auth, no database query.

    A malformed path is a 404 rather than a 400 — it says the same thing to the
    caller and keeps this endpoint from becoming a probe for which user ids
    exist.
    """
    if not filename.endswith(".webp"):
        return Response(status_code=404)
    blob_id = filename[: -len(".webp")]
    if not _UUID_RE.match(user_id) or not _BLOB_RE.match(blob_id):
        return Response(status_code=404)

    etag = f'"{blob_id}"'
    # The bytes at a given URL never change (a new upload gets a new blob_id),
    # so a matching If-None-Match can be answered without touching storage.
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})

    store = get_file_store()
    try:
        data = await asyncio.to_thread(store.read, storage_key(user_id, blob_id))
    except FileNotFoundError:
        return Response(status_code=404)
    except Exception:
        logger.exception("avatar: failed to read blob %s/%s", user_id, blob_id)
        return Response(status_code=404)

    return Response(
        content=data,
        media_type="image/webp",
        headers={
            "ETag": etag,
            # `private`, not `public`: the URL is a capability, and a shared
            # cache we can't purge would outlive any removal. max-age is the
            # revocation window — deliberately not `immutable`.
            "Cache-Control": f"private, max-age={config.AVATAR_CACHE_MAX_AGE}",
            "X-Content-Type-Options": "nosniff",
        },
    )

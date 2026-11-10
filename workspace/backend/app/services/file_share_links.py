# -*- coding: utf-8 -*-
"""Revoking "anyone with the link" file links (see app/routers/file_links.py).

A link dies with its file leaving the active set — trashed, deleted, or
replaced by a new upload at the same path. Restoring the file from the trash
does not bring the link back: whoever shared it shares again, deliberately.
"""

from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import FileShareLink


def revoke_file_links(db: Session, file_ids: Iterable[str]) -> None:
    """Stamp revoked_at on every live link of these files. The caller commits."""
    ids = [str(i) for i in file_ids if i]
    if not ids:
        return
    db.execute(
        update(FileShareLink)
        .where(FileShareLink.file_id.in_(ids), FileShareLink.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )

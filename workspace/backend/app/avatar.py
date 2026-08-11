# -*- coding: utf-8 -*-
"""
Avatar image validation and transcoding.

Every uploaded image is decoded and re-encoded to a fixed-size WebP. That
re-encode is the security boundary, not an optimization — whatever arrives,
what we store is a buffer Pillow produced:

* **Stored XSS** — SVG (and HTML/SVG polyglots) can carry <script>. Nothing
  that isn't a raster image Pillow recognizes survives the round trip, and the
  content type we serve is always image/webp.
* **Location leak** — phone photos routinely carry GPS coordinates in EXIF.
  Re-encoding drops every EXIF tag.
* **Decompression bomb** — a few KB of PNG can expand to gigabytes of pixels,
  so the pixel count is checked before any pixel work happens.

All decode work runs in a thread (see `process_avatar`) under a semaphore, so a
burst of uploads can't monopolize the event loop or the worker's memory.
"""

import asyncio
import io
import logging
import secrets
from typing import Optional

from app.config import config

logger = logging.getLogger(__name__)

# Magic-byte prefixes for the formats we accept. The declared Content-Type is
# never trusted: it's attacker-controlled, and "image/png" on an SVG body is
# exactly how a polyglot gets in.
_MAGIC = (
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
)

_STORAGE_PREFIX = "avatars"

# One semaphore per process; see AVATAR_DECODE_CONCURRENCY in config.
_decode_semaphore: Optional[asyncio.Semaphore] = None


class AvatarError(Exception):
    """Rejected upload. The message is safe to return to the caller.

    `status` lets the router map size rejections to 413 while everything else
    stays a 400 — none of these may surface as a 500.
    """

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _sniff(data: bytes) -> Optional[str]:
    """Identify the image type from its leading bytes, or None if unknown."""
    for prefix, name in _MAGIC:
        if data.startswith(prefix):
            return name
    # WebP is RIFF-framed: "RIFF" <4-byte size> "WEBP".
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def storage_key(user_id: str, blob_id: str) -> str:
    """The FileStore key for an avatar blob.

    Mirrors what LocalFileStore/S3FileStore build from
    `save(workspace_id, file_id, filename)` — kept in one place so the read path
    and the write path can't drift apart.
    """
    return f"{_STORAGE_PREFIX}/{user_id}/{blob_id}.webp"


def new_blob_id() -> str:
    """A fresh 128-bit blob id.

    Random rather than a content hash, for two reasons. It makes concurrent
    uploads by the same user impossible to collide, so neither can delete the
    key the other just committed. And it makes the URL itself the capability —
    an avatar URL carries no reusable credential, unlike the `?token=` scheme
    the file download endpoint uses (that token bypasses role checks and is
    deliberately withheld from viewers).
    """
    return secrets.token_hex(16)


def _transcode(data: bytes) -> bytes:
    """Decode, normalize and re-encode. Synchronous — call via a thread."""
    # Imported lazily so the module imports cleanly without Pillow installed;
    # only the avatar path needs it.
    from PIL import Image, ImageOps, UnidentifiedImageError

    size = config.AVATAR_SIZE

    try:
        img = Image.open(io.BytesIO(data))
    except UnidentifiedImageError:
        raise AvatarError("Unrecognized image format")
    except Exception:
        raise AvatarError("Could not read the image")

    try:
        # Bomb check first: img.size is read from the header, before Pillow has
        # allocated anything for the pixels.
        width, height = img.size
        if width <= 0 or height <= 0:
            raise AvatarError("Image has no content")
        if width * height > config.AVATAR_MAX_PIXELS:
            raise AvatarError("Image dimensions are too large")

        # Animated GIF / WebP: take the first frame and drop the rest.
        try:
            img.seek(0)
        except (AttributeError, EOFError):
            pass

        # Bake EXIF orientation into the pixels. This has to happen BEFORE the
        # crop: a phone's portrait photo is stored landscape with an orientation
        # tag, and re-encoding drops that tag. Crop first and the avatar ends up
        # rotated 90°, cropped along the wrong axis.
        img = ImageOps.exif_transpose(img)

        # Normalize CMYK / palette / grayscale / LA into something WebP encodes
        # predictably, keeping alpha for images that have it.
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if img.mode in ("P", "LA", "PA") else "RGB")

        # Center-crop to a square, then scale. ImageOps.fit does both and picks
        # a decent resampling filter.
        img = ImageOps.fit(img, (size, size), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

        out = io.BytesIO()
        img.save(out, format="WEBP", quality=85, method=4)
        return out.getvalue()
    except AvatarError:
        raise
    except Image.DecompressionBombError:
        raise AvatarError("Image dimensions are too large")
    except OSError:
        # Truncated or corrupt payloads land here during the decode.
        raise AvatarError("The image file is damaged or incomplete")
    except Exception:
        logger.exception("avatar: unexpected failure while transcoding")
        raise AvatarError("Could not process the image")
    finally:
        try:
            img.close()
        except Exception:
            pass


async def process_avatar(data: bytes) -> bytes:
    """Validate `data` and return the WebP bytes to store.

    Raises `AvatarError` for anything the caller sent wrong — a rejected upload
    is never a 500.
    """
    global _decode_semaphore

    if not data:
        raise AvatarError("The uploaded file is empty")

    kind = _sniff(data)
    if kind is None:
        # Covers SVG, HTML, PDFs, and anything else dressed up as an image.
        raise AvatarError("Unsupported image type. Use JPEG, PNG, GIF or WebP.")

    if _decode_semaphore is None:
        _decode_semaphore = asyncio.Semaphore(max(1, config.AVATAR_DECODE_CONCURRENCY))

    async with _decode_semaphore:
        return await asyncio.to_thread(_transcode, data)


async def read_upload_limited(upload, limit: int) -> bytes:
    """Read an UploadFile, aborting as soon as it exceeds `limit` bytes.

    Reads in chunks rather than `await upload.read()` so an oversized upload is
    rejected without first materializing all of it in memory — the check is the
    point, and doing it after the read defeats it.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise AvatarError(
                f"Image is too large. Maximum size: {limit // (1024 * 1024)}MB",
                status=413,
            )
        chunks.append(chunk)
    return b"".join(chunks)

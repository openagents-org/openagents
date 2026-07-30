# -*- coding: utf-8 -*-
"""
File type classification.

The server-side twin of the frontend's `components/files/file-utils.tsx`. Both
sides answer the same two questions and must answer them identically, or a
filter menu written by one will disagree with the list rendered by the other:

  kind  — what a file *is* (pdf, image, code, …); drives glyph and colour
  group — how a file is *looked for* (documents, images, …); drives filtering

Extension wins over content type: uploads routinely arrive as
application/octet-stream, and the name is what the user sees.
"""

from typing import Optional

# --- kinds -----------------------------------------------------------------

KINDS = (
    "pdf", "doc", "sheet", "slides", "markdown", "text", "code",
    "image", "audio", "video", "web", "archive", "unknown",
)

EXTENSION_KINDS: dict[str, str] = {
    "pdf": "pdf",

    "doc": "doc", "docx": "doc", "odt": "doc", "rtf": "doc", "pages": "doc",

    "xls": "sheet", "xlsx": "sheet", "xlsm": "sheet", "ods": "sheet",
    "csv": "sheet", "tsv": "sheet", "numbers": "sheet",

    "ppt": "slides", "pptx": "slides", "odp": "slides", "key": "slides",

    "md": "markdown", "markdown": "markdown", "mdx": "markdown",

    "txt": "text", "log": "text", "text": "text",

    "js": "code", "mjs": "code", "cjs": "code", "jsx": "code",
    "ts": "code", "tsx": "code", "py": "code", "rb": "code", "rs": "code",
    "go": "code", "java": "code", "kt": "code", "c": "code", "h": "code",
    "cpp": "code", "hpp": "code", "cs": "code", "swift": "code", "php": "code",
    "sh": "code", "bash": "code", "zsh": "code", "sql": "code", "r": "code",
    "json": "code", "yaml": "code", "yml": "code", "toml": "code", "xml": "code",
    "ini": "code", "cfg": "code", "conf": "code", "env": "code",
    "css": "code", "scss": "code", "less": "code", "vue": "code",
    "svelte": "code", "ipynb": "code",

    "png": "image", "jpg": "image", "jpeg": "image", "gif": "image",
    "webp": "image", "svg": "image", "bmp": "image", "ico": "image",
    "avif": "image", "heic": "image", "tiff": "image",

    "mp3": "audio", "wav": "audio", "ogg": "audio", "m4a": "audio",
    "flac": "audio", "aac": "audio", "opus": "audio",

    "mp4": "video", "mov": "video", "avi": "video", "webm": "video",
    "mkv": "video", "m4v": "video",

    "html": "web", "htm": "web", "url": "web",

    "zip": "archive", "tar": "archive", "gz": "archive", "tgz": "archive",
    "rar": "archive", "7z": "archive", "bz2": "archive", "xz": "archive",
}

# --- groups ----------------------------------------------------------------

#: Filter groups, in the order the UI lists them.
FILTER_GROUPS = (
    "documents", "sheets", "slides", "images", "audio",
    "video", "code", "web", "archives", "other",
)

KIND_GROUPS: dict[str, str] = {
    "pdf": "documents",
    "doc": "documents",
    "markdown": "documents",
    "text": "documents",
    "sheet": "sheets",
    "slides": "slides",
    "image": "images",
    "audio": "audio",
    "video": "video",
    "code": "code",
    "web": "web",
    "archive": "archives",
    "unknown": "other",
}


def extension_of(filename: str) -> str:
    """Lowercased extension without the dot — '' when the name has none."""
    base = filename.rsplit("/", 1)[-1]
    dot = base.rfind(".")
    if dot <= 0 or dot == len(base) - 1:
        return ""
    return base[dot + 1:].lower()


def kind_for(filename: str, content_type: Optional[str] = None) -> str:
    """Resolve a file to its kind — extension first, content type as fallback."""
    name = filename or ""
    lowered = name.lower()
    if lowered.startswith("http://") or lowered.startswith("https://"):
        return "web"

    by_extension = EXTENSION_KINDS.get(extension_of(name))
    if by_extension:
        return by_extension

    ct = (content_type or "").lower()
    if ct.startswith("image/"):
        return "image"
    if ct.startswith("audio/"):
        return "audio"
    if ct.startswith("video/"):
        return "video"
    if ct == "application/pdf":
        return "pdf"
    if ct == "text/html":
        return "web"
    if ct == "text/markdown":
        return "markdown"
    if ct == "text/csv" or "spreadsheet" in ct or "excel" in ct:
        return "sheet"
    if "presentation" in ct or "powerpoint" in ct:
        return "slides"
    if "word" in ct or ct == "application/rtf":
        return "doc"
    if "zip" in ct or "compressed" in ct or "tar" in ct:
        return "archive"
    if "json" in ct or "javascript" in ct or "xml" in ct or "yaml" in ct:
        return "code"
    if ct.startswith("text/"):
        return "text"

    return "unknown"


def group_for(filename: str, content_type: Optional[str] = None) -> str:
    """The filter group a file belongs to."""
    return KIND_GROUPS[kind_for(filename, content_type)]

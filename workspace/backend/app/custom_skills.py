# -*- coding: utf-8 -*-
"""
Workspace-scoped custom skills: validation + metadata helpers.

A custom skill is a user-uploaded ``.md`` or ``.zip`` package that lives as a
workspace ``FileRecord`` and is registered in
``Workspace.settings["custom_skills"]`` (keyed by skill id). Unlike catalog
skills — which the launcher fetches from GitHub via ``source_repo`` /
``source_path`` — a custom skill is downloaded by the agent from workspace file
storage using ``WorkspaceClient.readFile`` and installed locally.

Security note: the validation here is server-side and is NOT a substitute for
the agent-side extraction guards in
``packages/agent-connector/src/skill-installer.js``. Both layers validate. We
inspect the uploaded *bytes* (never trusting the client-provided
``content_type``) to confirm the declared package type and, for zips, that a
``SKILL.md`` is present and no entry is dangerous (path traversal, absolute
path, symlink, or a zip bomb).
"""

import io
import os
import re
import zipfile

# Category id / source_type shared with the frontend + agent connector.
CUSTOM_SKILL_CATEGORY = "custom"
CUSTOM_SKILL_SOURCE_TYPE = "workspace_file"

# Mirrors the launcher's _ID_RE in skill-installer.js so an id accepted here
# also passes the agent-side guard (no leading dash, no slashes, no dots-only).
SKILL_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")

ALLOWED_EXTENSIONS = {".md", ".zip"}

# Zip-bomb / abuse guards on the *uncompressed* side. The raw upload itself is
# already capped by ``config.MAX_FILE_SIZE`` at the /v1/files endpoint.
MAX_ZIP_ENTRIES = 2000
MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024   # 50 MB expanded total
MAX_ZIP_COMPRESSION_RATIO = 200                  # expanded / stored, per package


class CustomSkillError(ValueError):
    """Raised for any invalid custom-skill upload. The message is user-safe."""


def derive_skill_id(filename: str) -> str:
    """Best-effort skill id from a filename (used when the client omits one)."""
    base = os.path.basename(filename or "")
    stem = os.path.splitext(base)[0]
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip("-._")
    return (cleaned[:64] or "custom-skill")


def is_valid_skill_id(skill_id: str) -> bool:
    return bool(skill_id) and skill_id not in (".", "..") and bool(SKILL_ID_RE.match(skill_id))


def _ext_of(filename: str) -> str:
    return os.path.splitext(os.path.basename(filename or ""))[1].lower()


def _is_unsafe_zip_name(name: str) -> bool:
    """Reject absolute paths, Windows drive paths, and ``..`` traversal."""
    if not name:
        return True
    if name.startswith("/") or name.startswith("\\"):
        return True
    if re.match(r"^[A-Za-z]:", name):  # e.g. "C:\..."
        return True
    parts = re.split(r"[\\/]", name)
    return any(p == ".." for p in parts)


def _is_symlink_entry(info: "zipfile.ZipInfo") -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return (mode & 0o170000) == 0o120000  # S_IFLNK


def _zip_has_skill_md(names) -> bool:
    """True if a ``SKILL.md`` exists at the archive root, or directly inside a
    single top-level directory (the two layouts the agent installer supports)."""
    top_level_files = set()
    dir_roots = set()
    for n in names:
        n2 = n.strip("/")
        if not n2:
            continue
        segs = n2.split("/")
        if len(segs) == 1:
            top_level_files.add(segs[0])
        else:
            dir_roots.add(segs[0])

    if any(f.lower() == "skill.md" for f in top_level_files):
        return True
    # Single top-level dir, no root-level files → look one level down.
    if len(dir_roots) == 1 and not top_level_files:
        only = next(iter(dir_roots))
        for n in names:
            segs = n.strip("/").split("/")
            if len(segs) == 2 and segs[0] == only and segs[1].lower() == "skill.md":
                return True
    return False


def inspect_package(data: bytes, filename: str) -> dict:
    """Validate an uploaded skill package by inspecting its bytes.

    Returns ``{"package_type": "md"|"zip", "content_type": str}`` on success, or
    raises :class:`CustomSkillError` with a user-safe message.
    """
    ext = _ext_of(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise CustomSkillError(
            f"Unsupported file type '{ext or filename}'. Only .md and .zip are allowed."
        )
    if not data:
        raise CustomSkillError("Uploaded file is empty.")

    if ext == ".md":
        # Bytes must be text — reject a binary payload masquerading as .md.
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise CustomSkillError("The .md file is not valid UTF-8 text.")
        if not text.strip():
            raise CustomSkillError("The .md file is empty.")
        return {"package_type": "md", "content_type": "text/markdown"}

    # ── .zip ──
    if data[:2] != b"PK":
        raise CustomSkillError("File does not look like a valid .zip archive.")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise CustomSkillError("The .zip archive is corrupt or unreadable.")

    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise CustomSkillError(f"Archive has too many entries (> {MAX_ZIP_ENTRIES}).")
        total_uncompressed = 0
        total_compressed = 0
        names = []
        for info in infos:
            name = info.filename
            if _is_unsafe_zip_name(name):
                raise CustomSkillError(f"Archive contains an unsafe path: {name!r}")
            if _is_symlink_entry(info):
                raise CustomSkillError(f"Archive contains a symlink entry: {name!r}")
            total_uncompressed += info.file_size
            total_compressed += info.compress_size
            names.append(name)
        if total_uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES:
            raise CustomSkillError("Archive expands too large.")
        if total_compressed > 0 and (total_uncompressed / total_compressed) > MAX_ZIP_COMPRESSION_RATIO:
            raise CustomSkillError("Archive compression ratio looks abusive (possible zip bomb).")
        if not _zip_has_skill_md(names):
            raise CustomSkillError(
                "The .zip must contain a SKILL.md (at the root or inside a single top-level folder)."
            )

    return {"package_type": "zip", "content_type": "application/zip"}

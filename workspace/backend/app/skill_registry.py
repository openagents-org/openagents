# -*- coding: utf-8 -*-
"""Core helpers shared by workspace skill authoring and the public registry."""

import hashlib
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    FileRecord,
    RegistrySkill,
    RegistrySkillVersion,
    SkillNamespace,
    WorkspaceSkill,
    WorkspaceSkillVersion,
)
from app.skill_catalog import SKILL_CATALOG
from app.storage import get_file_store


PUBLIC_LICENSES = {"MIT", "Apache-2.0", "CC-BY-4.0", "CC-BY-SA-4.0"}
_SLUG_RE = re.compile(r"[^a-z0-9-]+")
_BIDI = {"\u202a", "\u202b", "\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069"}


def slugify(value: str, fallback: str = "skill") -> str:
    value = _SLUG_RE.sub("-", (value or "").strip().lower().replace("_", "-"))
    value = re.sub(r"-+", "-", value).strip("-")
    return (value[:64] or fallback)


def markdown_frontmatter(text: str) -> dict:
    """Parse the small frontmatter subset needed by the MVP without YAML deps."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    out = {}
    for line in text[3:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key in {"name", "description"}:
            out[key] = value.strip().strip("'\"")
    return out


def scan_public_markdown(data: bytes) -> tuple[dict, dict]:
    """Validate Markdown-only UGC and return (frontmatter, scan report)."""
    if len(data) > 512 * 1024:
        raise ValueError("Public Markdown skills are limited to 512 KB")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Public skills must be UTF-8 Markdown") from exc
    if not text.strip():
        raise ValueError("Skill Markdown is empty")
    if "\x00" in text or any(ch in text for ch in _BIDI):
        raise ValueError("Skill contains hidden or bidirectional control characters")
    if "-----BEGIN PRIVATE KEY-----" in text:
        raise ValueError("Skill appears to contain a private key")
    fm = markdown_frontmatter(text)
    if not fm.get("name") or not fm.get("description"):
        raise ValueError("Public skills require frontmatter name and description")
    lowered = text.lower()
    if re.search(r"(?:curl|wget)[^\n|]{0,300}\|\s*(?:ba)?sh\b", lowered):
        raise ValueError("Public skills cannot contain pipe-to-shell instructions")
    findings = []
    for marker, label in (
        ("printenv", "environment access"),
        (".env", "environment file access"),
    ):
        if marker in lowered:
            findings.append(label)
    return fm, {
        "scanner": "registry-mvp-v1",
        "status": "passed_with_findings" if findings else "passed",
        "findings": sorted(set(findings)),
    }


def create_workspace_version(
    db: Session,
    skill: WorkspaceSkill,
    file_record: FileRecord,
    data: bytes,
    package_type: str,
    created_by: str,
    changelog: str = "",
) -> WorkspaceSkillVersion:
    last_seq = db.execute(
        select(WorkspaceSkillVersion.version_seq)
        .where(WorkspaceSkillVersion.workspace_skill_id == skill.id)
        .order_by(WorkspaceSkillVersion.version_seq.desc())
        .limit(1)
    ).scalar_one_or_none() or 0
    seq = last_seq + 1
    fm = {}
    if package_type == "md":
        try:
            fm = markdown_frontmatter(data.decode("utf-8"))
        except UnicodeDecodeError:
            fm = {}
    version = WorkspaceSkillVersion(
        workspace_skill_id=skill.id,
        version_seq=seq,
        version=f"{seq}.0.0",
        file_id=file_record.id,
        package_type=package_type,
        content_sha256=hashlib.sha256(data).hexdigest(),
        frontmatter=fm,
        changelog=changelog,
        created_by=created_by,
    )
    db.add(version)
    db.flush()
    skill.latest_version_id = version.id
    skill.updated_at = datetime.now(timezone.utc)
    return version


def materialize_legacy_workspace_skills(db: Session, workspace) -> list[WorkspaceSkill]:
    """Lazily convert JSONB custom skills once their backing bytes are readable."""
    existing = db.execute(
        select(WorkspaceSkill).where(
            WorkspaceSkill.workspace_id == workspace.id,
            WorkspaceSkill.status == "active",
        )
    ).scalars().all()
    by_slug = {s.slug: s for s in existing}
    legacy = dict((workspace.settings or {}).get("custom_skills") or {})
    store = get_file_store()
    changed = False
    for legacy_slug, entry in legacy.items():
        slug = slugify(entry.get("id") or legacy_slug)
        if slug in by_slug:
            continue
        file_record = db.get(FileRecord, entry.get("file_id"))
        if not file_record or file_record.workspace_id != workspace.id or file_record.status != "active":
            continue
        try:
            data = store.read(file_record.storage_key)
        except (FileNotFoundError, OSError):
            continue
        skill = WorkspaceSkill(
            workspace_id=workspace.id,
            slug=slug,
            name=entry.get("name") or slug,
            summary=entry.get("description") or "",
            category="custom",
            tags=entry.get("tags") or [],
            created_by=entry.get("author") or file_record.uploaded_by,
        )
        db.add(skill)
        db.flush()
        create_workspace_version(
            db, skill, file_record, data,
            entry.get("package_type") or "md",
            file_record.uploaded_by,
            "Imported from legacy custom skill",
        )
        by_slug[slug] = skill
        changed = True
    if changed:
        db.commit()
    return list(by_slug.values())


def ensure_builtin_registry(db: Session) -> None:
    """Idempotently expose the existing backend catalog as upstream pointers."""
    namespaces: dict[str, SkillNamespace] = {}
    for entry in SKILL_CATALOG:
        repo = entry.get("source_repo") or "openagents/catalog"
        owner = repo.split("/", 1)[0]
        ns_slug = slugify(owner, "openagents")
        ns = namespaces.get(ns_slug)
        if ns is None:
            ns = db.execute(select(SkillNamespace).where(SkillNamespace.slug == ns_slug)).scalar_one_or_none()
        if ns is None:
            ns = SkillNamespace(
                slug=ns_slug,
                type="official" if ns_slug == "openagents" else "external",
                display_name=entry.get("author") or owner,
                source_url=f"https://github.com/{repo}",
                verified_at=datetime.now(timezone.utc),
            )
            db.add(ns)
            db.flush()
        namespaces[ns_slug] = ns
        existing = db.execute(
            select(RegistrySkill.id).where(
                RegistrySkill.namespace_id == ns.id,
                RegistrySkill.slug == slugify(entry["id"]),
            )
        ).first()
        if existing:
            continue
        skill = RegistrySkill(
            namespace_id=ns.id,
            slug=slugify(entry["id"]),
            name=entry.get("name") or entry["id"],
            summary=entry.get("description") or "",
            category=entry.get("category") or "other",
            tags=entry.get("tags") or [],
            visibility="public",
        )
        db.add(skill)
        db.flush()
        if repo.lower() == "terminalskills/skills":
            license_spdx = "Apache-2.0"
        elif repo.lower() == "opensensenova/sensenova-skills":
            license_spdx = "MIT"
        else:
            # Anthropic contains both open and source-available packages. Keep
            # these entries pointer-only and do not claim redistribution rights.
            license_spdx = "LicenseRef-Upstream"
        version = RegistrySkillVersion(
            skill_id=skill.id,
            version="upstream",
            version_seq=1,
            source_mode="upstream_pointer",
            source_repo=repo,
            source_path=entry.get("source_path"),
            package_type="zip",
            license_spdx=license_spdx,
            attribution_snapshot={
                "author": entry.get("author") or owner,
                "source_url": f"https://github.com/{repo}/tree/main/{entry.get('source_path', '')}",
            },
            capabilities={"scripts": "unknown", "source": "upstream"},
            scan_result={"status": "not_mirrored"},
        )
        db.add(version)
        db.flush()
        skill.latest_published_version_id = version.id
    db.commit()

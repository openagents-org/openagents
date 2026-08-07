# -*- coding: utf-8 -*-
"""Core helpers shared by workspace skill authoring and the public registry."""

import hashlib
import logging
import re
import threading
from datetime import datetime, timezone

from sqlalchemy import select, text
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
_BOOTSTRAP_LOCK = threading.Lock()
logger = logging.getLogger(__name__)


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
    for legacy_slug, entry in legacy.items():
        # Workspace skill ids already passed the custom-skill safety validator;
        # preserve dots/underscores so install status keys remain stable. Only
        # public Registry URL slugs are normalized with slugify().
        slug = (entry.get("id") or legacy_slug).strip()
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
    # The caller owns the transaction. This helper is used in the middle of
    # install/publish requests, so committing here could persist unrelated
    # caller state before the request has succeeded.
    db.flush()
    return list(by_slug.values())


def sync_builtin_registry(db: Session) -> None:
    """Idempotently sync the curated catalog into an existing transaction.

    The function deliberately does not commit. It is called only by the
    startup bootstrap (under a cross-process lock) and by explicit tests/tools,
    never by public GET endpoints.
    """
    desired_namespaces: dict[str, dict] = {}
    for entry in SKILL_CATALOG:
        repo = entry.get("source_repo") or "openagents/catalog"
        owner = repo.split("/", 1)[0]
        ns_slug = slugify(owner, "openagents")
        desired_namespaces.setdefault(ns_slug, {
            "type": "official" if ns_slug == "openagents" else "external",
            "display_name": entry.get("author") or owner,
            "source_url": f"https://github.com/{repo}",
        })

    existing_namespaces = db.execute(
        select(SkillNamespace).where(SkillNamespace.slug.in_(desired_namespaces))
    ).scalars().all()
    namespaces = {namespace.slug: namespace for namespace in existing_namespaces}
    for ns_slug, metadata in desired_namespaces.items():
        namespace = namespaces.get(ns_slug)
        if namespace is not None and (
            namespace.type not in {"official", "external"}
            or namespace.owner_user_id is not None
        ):
            # Repair data created before namespace reservation was enforced.
            # Keep the user's works together under a stable suffixed slug, then
            # create the reserved upstream namespace at its canonical slug.
            suffix = str(namespace.owner_user_id or namespace.id)[:8]
            candidate = slugify(f"{ns_slug}-{suffix}")
            counter = 2
            while db.execute(select(SkillNamespace.id).where(SkillNamespace.slug == candidate)).first():
                candidate = slugify(f"{ns_slug}-{suffix}-{counter}")
                counter += 1
            namespace.slug = candidate
            db.flush()
            namespace = None
        if namespace is None:
            namespace = SkillNamespace(
                slug=ns_slug,
                type=metadata["type"],
                display_name=metadata["display_name"],
                source_url=metadata["source_url"],
                verified_at=datetime.now(timezone.utc),
            )
            db.add(namespace)
            namespaces[ns_slug] = namespace
        else:
            # Catalog namespaces are reserved. Keep their display metadata in
            # sync, but never turn a user-owned namespace into an official one.
            if namespace.type in {"official", "external"} and namespace.owner_user_id is None:
                namespace.display_name = metadata["display_name"]
                namespace.source_url = metadata["source_url"]
        db.flush()

    namespace_ids = [namespace.id for namespace in namespaces.values()]
    existing_skills = db.execute(
        select(RegistrySkill).where(RegistrySkill.namespace_id.in_(namespace_ids))
    ).scalars().all()
    skills = {(skill.namespace_id, skill.slug): skill for skill in existing_skills}
    existing_versions = db.execute(
        select(RegistrySkillVersion).where(
            RegistrySkillVersion.skill_id.in_([skill.id for skill in existing_skills]),
            RegistrySkillVersion.version == "upstream",
        )
    ).scalars().all() if existing_skills else []
    versions = {version.skill_id: version for version in existing_versions}

    for entry in SKILL_CATALOG:
        repo = entry.get("source_repo") or "openagents/catalog"
        owner = repo.split("/", 1)[0]
        namespace = namespaces[slugify(owner, "openagents")]
        skill_slug = slugify(entry["id"])
        skill = skills.get((namespace.id, skill_slug))
        if skill is None:
            skill = RegistrySkill(
                namespace_id=namespace.id,
                slug=skill_slug,
                name=entry.get("name") or entry["id"],
                summary=entry.get("description") or "",
                category=entry.get("category") or "other",
                tags=entry.get("tags") or [],
                visibility="public",
                status="active",
            )
            db.add(skill)
            db.flush()
            skills[(namespace.id, skill_slug)] = skill
        skill.name = entry.get("name") or entry["id"]
        skill.summary = entry.get("description") or ""
        skill.category = entry.get("category") or "other"
        skill.tags = entry.get("tags") or []
        skill.visibility = "public"
        skill.status = "active"

        repo_lower = repo.lower()
        license_spdx = (
            "Apache-2.0" if repo_lower == "terminalskills/skills"
            else "MIT" if repo_lower == "opensensenova/sensenova-skills"
            else "LicenseRef-Upstream"
        )
        version = versions.get(skill.id)
        if version is None:
            version = RegistrySkillVersion(
                skill_id=skill.id,
                version="upstream",
                version_seq=1,
                license_spdx=license_spdx,
            )
            db.add(version)
            db.flush()
            versions[skill.id] = version
        version.status = "published"
        version.source_mode = "upstream_pointer"
        version.source_repo = repo
        version.source_path = entry.get("source_path")
        version.package_type = "zip"
        version.license_spdx = license_spdx
        version.attribution_snapshot = {
            "author": entry.get("author") or owner,
            "source_url": f"https://github.com/{repo}/tree/main/{entry.get('source_path', '')}",
        }
        version.capabilities = {"scripts": "unknown", "source": "upstream"}
        version.scan_result = {"status": "not_mirrored"}
        skill.latest_published_version_id = version.id
    db.flush()


def bootstrap_builtin_registry() -> None:
    """Run the catalog sync once at process startup with concurrency safety."""
    from app.database import SessionLocal

    with _BOOTSTRAP_LOCK:
        db = SessionLocal()
        try:
            if db.get_bind().dialect.name == "postgresql":
                db.execute(text("SELECT pg_advisory_xact_lock(hashtext('openagents.skill_registry.bootstrap.v1'))"))
            sync_builtin_registry(db)
            db.commit()
            logger.info("Skill registry catalog bootstrap complete")
        except Exception:
            db.rollback()
            logger.exception("Skill registry catalog bootstrap failed")
            raise
        finally:
            db.close()

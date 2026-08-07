# -*- coding: utf-8 -*-
"""Public Skill Registry and workspace publish/fork endpoints (MVP)."""

import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.orm import Session

from app.access import resolve_current_user, resolve_user_role, role_at_least, verify_workspace_access
from app.database import get_db
from app.models import (
    FileRecord,
    RegistrySkill,
    RegistrySkillVersion,
    SkillArtifact,
    SkillNamespace,
    Workspace,
    WorkspaceSkill,
    WorkspaceSkillVersion,
)
from app.response import ResponseCode, json_response, success_response
from app.skill_registry import (
    PUBLIC_LICENSES,
    create_workspace_version,
    materialize_legacy_workspace_skills,
    scan_public_markdown,
    slugify,
)
from app.storage import get_file_store

router = APIRouter(prefix="/v1", tags=["Skill Registry"])


class PublishRequest(BaseModel):
    license_spdx: str
    version: Optional[str] = None
    changelog: str = "Initial public release"


class ForkRequest(BaseModel):
    workspace_id: str
    version_id: Optional[str] = None
    slug: Optional[str] = None
    name: Optional[str] = None


def _version_payload(version: Optional[RegistrySkillVersion]) -> Optional[dict]:
    if version is None:
        return None
    return {
        "id": version.id,
        "version": version.version,
        "versionSeq": version.version_seq,
        "status": version.status,
        "sourceMode": version.source_mode,
        "sourceRepo": version.source_repo,
        "sourcePath": version.source_path,
        "contentSha256": version.content_sha256,
        "packageType": version.package_type,
        "license": version.license_spdx,
        "attribution": version.attribution_snapshot or {},
        "capabilities": version.capabilities or {},
        "scanResult": version.scan_result or {},
        "changelog": version.changelog,
        "publishedAt": version.published_at.isoformat() if version.published_at else None,
    }


def _skill_payload(skill: RegistrySkill, namespace: SkillNamespace, version: Optional[RegistrySkillVersion]) -> dict:
    return {
        "id": skill.id,
        "slug": skill.slug,
        "namespace": namespace.slug,
        "namespaceName": namespace.display_name,
        "name": skill.name,
        "summary": skill.summary,
        "description": skill.summary,
        "category": skill.category,
        "tags": skill.tags or [],
        "visibility": skill.visibility,
        "status": skill.status,
        "forkedFromVersionId": skill.forked_from_version_id,
        "installCount": skill.install_count,
        "latestVersion": _version_payload(version),
        "createdAt": skill.created_at.isoformat() if skill.created_at else None,
    }


def _get_public_version(db: Session, skill: RegistrySkill, version_id: Optional[str] = None) -> Optional[RegistrySkillVersion]:
    target = version_id or skill.latest_published_version_id
    if not target:
        return None
    return db.execute(
        select(RegistrySkillVersion).where(
            RegistrySkillVersion.id == target,
            RegistrySkillVersion.skill_id == skill.id,
            RegistrySkillVersion.status == "published",
        )
    ).scalar_one_or_none()


@router.get("/registry/skills")
def search_registry_skills(
    q: str = Query("", max_length=200),
    category: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = (
        select(RegistrySkill, SkillNamespace, RegistrySkillVersion)
        .join(SkillNamespace, SkillNamespace.id == RegistrySkill.namespace_id)
        .outerjoin(RegistrySkillVersion, RegistrySkillVersion.id == RegistrySkill.latest_published_version_id)
        .where(RegistrySkill.visibility == "public", RegistrySkill.status == "active")
    )
    if category:
        query = query.where(RegistrySkill.category == category)
    term = q.strip().lower()
    if term:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.where(or_(
            func.lower(RegistrySkill.name).like(pattern, escape="\\"),
            func.lower(RegistrySkill.slug).like(pattern, escape="\\"),
            func.lower(RegistrySkill.summary).like(pattern, escape="\\"),
            func.lower(SkillNamespace.display_name).like(pattern, escape="\\"),
            func.lower(cast(RegistrySkill.tags, Text)).like(pattern, escape="\\"),
        ))
    rows = db.execute(
        query.order_by(RegistrySkill.install_count.desc(), RegistrySkill.created_at.desc())
        .offset(offset).limit(limit)
    ).all()
    return success_response({
        "skills": [_skill_payload(skill, namespace, version) for skill, namespace, version in rows],
        "offset": offset,
        "limit": limit,
    })


@router.get("/registry/skills/{namespace_slug}/{skill_slug}")
def get_registry_skill(namespace_slug: str, skill_slug: str, db: Session = Depends(get_db)):
    row = db.execute(
        select(RegistrySkill, SkillNamespace)
        .join(SkillNamespace, SkillNamespace.id == RegistrySkill.namespace_id)
        .where(
            SkillNamespace.slug == namespace_slug,
            RegistrySkill.slug == skill_slug,
            RegistrySkill.visibility == "public",
            RegistrySkill.status == "active",
        )
    ).first()
    if not row:
        return json_response(ResponseCode.NOT_FOUND, "Skill not found")
    skill, namespace = row
    versions = db.execute(
        select(RegistrySkillVersion)
        .where(RegistrySkillVersion.skill_id == skill.id, RegistrySkillVersion.status.in_(["published", "yanked"]))
        .order_by(RegistrySkillVersion.version_seq.desc())
    ).scalars().all()
    data = _skill_payload(skill, namespace, _get_public_version(db, skill))
    data["versions"] = [_version_payload(v) for v in versions]
    return success_response(data)


@router.get("/registry/versions/{version_id}/download")
def download_registry_version(version_id: str, db: Session = Depends(get_db)):
    row = db.execute(
        select(RegistrySkillVersion, RegistrySkill, SkillArtifact)
        .join(RegistrySkill, RegistrySkill.id == RegistrySkillVersion.skill_id)
        .outerjoin(SkillArtifact, SkillArtifact.id == RegistrySkillVersion.artifact_id)
        .where(
            RegistrySkillVersion.id == version_id,
            RegistrySkillVersion.status == "published",
            RegistrySkill.status == "active",
            RegistrySkill.visibility == "public",
        )
    ).first()
    if not row:
        return json_response(ResponseCode.NOT_FOUND, "Published skill version not found")
    version, _skill, artifact = row
    if version.source_mode != "mirrored" or artifact is None:
        return json_response(ResponseCode.CONFLICT, "This version is installed from its verified upstream source")
    try:
        data = get_file_store().read(artifact.storage_key)
    except FileNotFoundError:
        return json_response(ResponseCode.NOT_FOUND, "Artifact data is unavailable")
    if hashlib.sha256(data).hexdigest() != artifact.sha256:
        return json_response(ResponseCode.INTERNAL_ERROR, "Artifact integrity check failed")
    media_type = "text/markdown; charset=utf-8" if artifact.package_type == "md" else "application/zip"
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{artifact.filename}"',
            "X-Content-SHA256": artifact.sha256,
        },
    )


@router.post("/workspaces/{workspace_id}/skills/{workspace_skill_id}/publish")
def publish_workspace_skill(
    workspace_id: str,
    workspace_skill_id: str,
    body: PublishRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = db.get(Workspace, workspace_id)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    user = resolve_current_user(db, authorization)
    if user is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in is required to publish a public skill")
    role = resolve_user_role(db, workspace, authorization)
    if not role_at_least(role, "member"):
        return json_response(ResponseCode.FORBIDDEN, "Workspace membership is required to publish")
    if body.license_spdx not in PUBLIC_LICENSES:
        return json_response(ResponseCode.BAD_REQUEST, "Public skills require a derivative-friendly license")

    materialize_legacy_workspace_skills(db, workspace)
    local = db.execute(select(WorkspaceSkill).where(
        WorkspaceSkill.id == workspace_skill_id,
        WorkspaceSkill.workspace_id == workspace.id,
        WorkspaceSkill.status == "active",
    )).scalar_one_or_none()
    if not local:
        return json_response(ResponseCode.NOT_FOUND, "Workspace skill not found")
    local_version = db.get(WorkspaceSkillVersion, local.latest_version_id)
    if not local_version:
        return json_response(ResponseCode.CONFLICT, "Workspace skill has no version")
    if local_version.package_type != "md":
        return json_response(ResponseCode.BAD_REQUEST, "MVP public UGC supports Markdown skills only")
    file_record = db.get(FileRecord, local_version.file_id)
    if not file_record or file_record.workspace_id != workspace.id or file_record.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Backing workspace file is unavailable")
    try:
        data = get_file_store().read(file_record.storage_key)
        frontmatter, scan_result = scan_public_markdown(data)
    except (FileNotFoundError, ValueError) as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))

    # Reuse the publisher's immutable namespace even if their display name
    # changes. New user namespaces always include an identity suffix, so an
    # arbitrary display name can never claim a canonical brand URL.
    namespace = db.execute(select(SkillNamespace).where(
        SkillNamespace.type == "user",
        SkillNamespace.owner_user_id == user.id,
        SkillNamespace.status == "active",
    ).order_by(SkillNamespace.created_at.asc())).scalars().first()
    if namespace is None:
        display_slug = slugify(user.display_name or user.email.split("@", 1)[0])
        base_slug = slugify(f"{display_slug}-{str(user.id)[:8]}")
        namespace_slug = base_slug
        namespace = db.execute(select(SkillNamespace).where(SkillNamespace.slug == namespace_slug)).scalar_one_or_none()
        counter = 2
        while namespace is not None:
            namespace_slug = slugify(f"{base_slug}-{counter}")
            namespace = db.execute(select(SkillNamespace).where(SkillNamespace.slug == namespace_slug)).scalar_one_or_none()
            counter += 1
        namespace = SkillNamespace(
            slug=namespace_slug,
            type="user",
            owner_user_id=user.id,
            display_name=user.display_name or user.email,
        )
        db.add(namespace)
        db.flush()

    registry_skill = db.get(RegistrySkill, local.registry_skill_id) if local.registry_skill_id else None
    public_slug = slugify(local.slug)
    if registry_skill is None:
        registry_skill = db.execute(select(RegistrySkill).where(
            RegistrySkill.namespace_id == namespace.id,
            RegistrySkill.slug == public_slug,
        )).scalar_one_or_none()
    if registry_skill is None:
        registry_skill = RegistrySkill(
            namespace_id=namespace.id,
            slug=public_slug,
            name=local.name,
            summary=local.summary or frontmatter.get("description", ""),
            category=local.category,
            tags=local.tags or [],
            visibility="public",
            forked_from_version_id=local.forked_from_version_id,
        )
        db.add(registry_skill)
        db.flush()
        local.registry_skill_id = registry_skill.id

    sha256 = hashlib.sha256(data).hexdigest()
    artifact = db.execute(select(SkillArtifact).where(SkillArtifact.sha256 == sha256)).scalar_one_or_none()
    if artifact is None:
        filename = f"{local.slug}.md"
        storage_key = get_file_store().save_artifact(sha256, filename, data)
        artifact = SkillArtifact(
            sha256=sha256,
            storage_key=storage_key,
            filename=filename,
            package_type="md",
            size=len(data),
            manifest={"files": [{"path": "SKILL.md", "sha256": sha256, "size": len(data)}]},
            scan_status=scan_result["status"],
        )
        db.add(artifact)
        db.flush()

    last_seq = db.execute(
        select(func.max(RegistrySkillVersion.version_seq)).where(RegistrySkillVersion.skill_id == registry_skill.id)
    ).scalar_one_or_none() or 0
    display_version = (body.version or f"{last_seq + 1}.0.0").strip()
    if not re.match(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$", display_version):
        return json_response(ResponseCode.BAD_REQUEST, "Version must be valid semver, for example 1.0.0")
    duplicate = db.execute(select(RegistrySkillVersion.id).where(
        RegistrySkillVersion.skill_id == registry_skill.id,
        RegistrySkillVersion.version == display_version,
    )).first()
    if duplicate:
        return json_response(ResponseCode.CONFLICT, "That public version already exists")
    version = RegistrySkillVersion(
        skill_id=registry_skill.id,
        version=display_version,
        version_seq=last_seq + 1,
        artifact_id=artifact.id,
        source_mode="mirrored",
        content_sha256=sha256,
        package_type="md",
        frontmatter=frontmatter,
        changelog=body.changelog.strip(),
        license_spdx=body.license_spdx,
        attribution_snapshot={
            "author": namespace.display_name,
            "namespace": namespace.slug,
            "forked_from_version_id": local.forked_from_version_id,
        },
        capabilities={"scripts": False, "network": "declared-in-instructions"},
        scan_result=scan_result,
        published_by_user_id=user.id,
    )
    db.add(version)
    db.flush()
    registry_skill.latest_published_version_id = version.id
    registry_skill.updated_at = datetime.now(timezone.utc)
    db.commit()
    return success_response(_skill_payload(registry_skill, namespace, version), "Skill published")


@router.post("/registry/skills/{skill_id}/fork")
def fork_registry_skill(
    skill_id: str,
    body: ForkRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = db.get(Workspace, body.workspace_id)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not verify_workspace_access(workspace, x_workspace_token, authorization, db=db, min_role="member"):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    skill = db.execute(select(RegistrySkill).where(
        RegistrySkill.id == skill_id,
        RegistrySkill.visibility == "public",
        RegistrySkill.status == "active",
    )).scalar_one_or_none()
    if not skill:
        return json_response(ResponseCode.NOT_FOUND, "Public skill not found")
    version = _get_public_version(db, skill, body.version_id)
    artifact = db.get(SkillArtifact, version.artifact_id) if version and version.artifact_id else None
    if not version or not artifact:
        return json_response(ResponseCode.BAD_REQUEST, "Pointer-only upstream skills cannot be forked until their license permits mirroring")
    if version.license_spdx not in PUBLIC_LICENSES:
        return json_response(ResponseCode.FORBIDDEN, "This version does not permit registry forks")
    try:
        data = get_file_store().read(artifact.storage_key)
    except FileNotFoundError:
        return json_response(ResponseCode.NOT_FOUND, "Artifact data is unavailable")
    base_slug = slugify(body.slug or skill.slug)
    target_slug = base_slug
    suffix = 2
    while db.execute(select(WorkspaceSkill.id).where(
        WorkspaceSkill.workspace_id == workspace.id,
        WorkspaceSkill.slug == target_slug,
    )).first():
        target_slug = f"{base_slug[:58]}-{suffix}"
        suffix += 1
    file_id = str(uuid.uuid4())
    filename = f"{target_slug}.md"
    storage_key = get_file_store().save(str(workspace.id), file_id, filename, data)
    user = resolve_current_user(db, authorization)
    created_by = f"human:{user.email}" if user else "human:user"
    record = FileRecord(
        id=file_id,
        workspace_id=workspace.id,
        filename=f"skills/{filename}",
        content_type="text/markdown",
        size=len(data),
        storage_key=storage_key,
        uploaded_by=created_by,
    )
    db.add(record)
    local = WorkspaceSkill(
        workspace_id=workspace.id,
        slug=target_slug,
        name=body.name or skill.name,
        summary=skill.summary,
        category="custom",
        tags=skill.tags or [],
        created_by=created_by,
        forked_from_version_id=version.id,
    )
    db.add(local)
    db.flush()
    local_version = create_workspace_version(
        db, local, record, data, "md", created_by,
        f"Forked from registry version {version.version}",
    )
    db.commit()
    return success_response({
        "id": local.id,
        "slug": local.slug,
        "name": local.name,
        "workspaceId": str(workspace.id),
        "versionId": local_version.id,
        "forkedFromVersionId": version.id,
    }, "Skill forked to workspace")

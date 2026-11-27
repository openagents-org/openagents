"""Opt-in public account profiles, independent of workspace membership."""
import re

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import resolve_current_user
from app.database import get_db
from app.models import PublicProfile, User
from app.response import ResponseCode, json_response, success_response

router = APIRouter(prefix="/v1", tags=["Profiles"])
_HANDLE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_RESERVED = {"admin", "api", "help", "openagents", "security", "support", "system"}
_IMAGE_DATA = re.compile(r"data:image/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+")


def normalize_handle(value: str) -> str | None:
    value = value.strip().lower()
    if 3 <= len(value) <= 28 and _HANDLE.fullmatch(value) and value not in _RESERVED:
        return value
    return None


def _own_profile(profile: PublicProfile | None) -> dict:
    return {
        "handle": profile.handle if profile else None,
        "bio": profile.bio if profile else "",
        "isPublic": bool(profile and profile.is_public),
    }


class ProfileUpdate(BaseModel):
    handle: str = Field(max_length=64)
    bio: str = Field(default="", max_length=160)
    is_public: bool = False


@router.get("/account/public-profile")
def get_own_profile(response: Response, db: Session = Depends(get_db), authorization: str | None = Header(None)):
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to manage your profile.")
    profile = db.get(PublicProfile, user.id)
    payload = _own_profile(profile)
    db.commit()
    response.headers["Cache-Control"] = "private, no-store"
    return success_response(payload)


@router.put("/account/public-profile")
def save_own_profile(body: ProfileUpdate, db: Session = Depends(get_db), authorization: str | None = Header(None)):
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to manage your profile.")
    if "\x00" in body.bio:
        return json_response(ResponseCode.BAD_REQUEST, "Remove invalid characters from your bio.")
    handle = normalize_handle(body.handle)
    if not handle:
        return json_response(ResponseCode.BAD_REQUEST, "Choose 3–28 letters, numbers or hyphens. This handle may be reserved.")

    # Serialize claims by the same account. The unique constraint handles claims
    # by different accounts, including simultaneous writes in separate workspaces.
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).scalar_one()
    profile = db.get(PublicProfile, user.id)
    if profile is None:
        profile = PublicProfile(user_id=user.id, handle=handle)
        db.add(profile)
    elif profile.handle != handle:
        return json_response(ResponseCode.CONFLICT, "Your account already has a permanent handle.")

    profile.bio = body.bio.strip()
    profile.is_public = body.is_public
    payload = _own_profile(profile)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return json_response(ResponseCode.CONFLICT, "This handle is already taken.")
    return success_response(payload)


@router.get("/profiles/{handle}")
def read_public_profile(handle: str, response: Response, db: Session = Depends(get_db)):
    handle = normalize_handle(handle)
    row = db.execute(
        select(PublicProfile, User.display_name, User.avatar_url)
        .join(User, PublicProfile.user_id == User.id)
        .where(PublicProfile.handle == handle, PublicProfile.is_public.is_(True))
    ).one_or_none() if handle else None
    if not row:
        error = json_response(ResponseCode.NOT_FOUND, "Profile unavailable.")
        error.headers["Cache-Control"] = "no-store"
        return error
    profile, display_name, avatar = row
    # Uploaded raster photos can be published. Existing external avatars can
    # contain signed or private URLs, so use the profile initials for those.
    safe_avatar = avatar if avatar and _IMAGE_DATA.fullmatch(avatar) else None
    response.headers["Cache-Control"] = "no-store"
    return success_response({
        "handle": profile.handle,
        "displayName": display_name or profile.handle,
        "bio": profile.bio,
        "avatarUrl": safe_avatar,
    })

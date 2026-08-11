# -*- coding: utf-8 -*-
"""
Mobile app version check (/v1/app/version).

GET /v1/app/version?platform=android|ios[&build=<n>]

Public and unauthenticated — the app asks before it has (or still has) a
workspace token, and the answer is the same for everyone. There is no DB
table behind it: the released build is a deployment fact, so it lives in
environment variables and a release is a config change, not a migration.

Two numbers drive the client:

* ``latest_build`` — a newer build exists; the app offers an update.
* ``min_build``    — anything below this is refused service by the app,
                     which shows a blocking prompt. Raise it only for a
                     release older clients genuinely cannot work against
                     (a breaking API change, a bad bug), because it locks
                     every user out of the app until they update.

Passing the caller's own ``build`` is optional; when it is present the
server does the comparison too, so the client doesn't have to reimplement
it (and old clients that don't send it still get the raw numbers).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Query

from app.config import config
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["App"])

SUPPORTED_PLATFORMS = ("android", "ios")


def _platform_config(platform: str) -> dict:
    """The released build for one platform, straight from config."""
    if platform == "ios":
        return {
            "latest_version": config.APP_IOS_LATEST_VERSION,
            "latest_build": config.APP_IOS_LATEST_BUILD,
            "min_build": config.APP_IOS_MIN_BUILD,
            "url": config.APP_IOS_UPDATE_URL,
            "notes": config.APP_IOS_RELEASE_NOTES,
        }
    return {
        "latest_version": config.APP_ANDROID_LATEST_VERSION,
        "latest_build": config.APP_ANDROID_LATEST_BUILD,
        "min_build": config.APP_ANDROID_MIN_BUILD,
        "url": config.APP_ANDROID_UPDATE_URL,
        "notes": config.APP_ANDROID_RELEASE_NOTES,
    }


@router.get("/app/version")
def app_version(
    platform: str = Query(..., description="android | ios"),
    build: Optional[int] = Query(
        None, description="The caller's own build number, to have the server compare"
    ),
):
    """Latest released mobile build, and whether the caller has to update."""
    platform = (platform or "").strip().lower()
    if platform not in SUPPORTED_PLATFORMS:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"platform must be one of {', '.join(SUPPORTED_PLATFORMS)}",
        )

    released = _platform_config(platform)
    latest_build = released["latest_build"]
    min_build = released["min_build"]

    # An unconfigured deployment (latest_build 0) must never tell a client it
    # is out of date — that would strand every user behind a forced update
    # prompt pointing at a release that doesn't exist.
    update_available = bool(build is not None and latest_build > 0 and build < latest_build)
    force_update = bool(build is not None and min_build > 0 and build < min_build)

    return success_response(
        {
            "platform": platform,
            "latest_version": released["latest_version"],
            "latest_build": latest_build,
            "min_build": min_build,
            "url": released["url"],
            "notes": released["notes"],
            "update_available": update_available,
            "force_update": force_update,
        }
    )

# -*- coding: utf-8 -*-
"""
Web image search for agents.

POST /v1/search/images — proxy to Brave Image Search. The API key is
resolved per workspace (settings.brave_search_api_key) with the
BRAVE_SEARCH_API_KEY env var as fallback, so a single deployment key can
serve all workspaces until they bring their own.

Agents display results by embedding markdown images (![title](image_url))
in their chat replies — the frontend renders those inline — or persist one
via POST /v1/files/from_url (optionally posting it into the channel as an
attachment).
"""

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/search", tags=["Search"])

BRAVE_IMAGE_SEARCH_URL = "https://api.search.brave.com/res/v1/images/search"
MAX_RESULTS = 20


class ImageSearchRequest(BaseModel):
    query: str
    network: str
    count: int = 10
    safesearch: str = "strict"          # strict | off (Brave image search values)


def _resolve_search_key(workspace) -> Optional[str]:
    settings = workspace.settings or {}
    return settings.get("brave_search_api_key") or os.environ.get("BRAVE_SEARCH_API_KEY") or None


async def _brave_image_search(key: str, query: str, count: int, safesearch: str) -> list[dict]:
    """Call Brave Image Search and map results to our schema."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            BRAVE_IMAGE_SEARCH_URL,
            params={"q": query, "count": count, "safesearch": safesearch},
            headers={"X-Subscription-Token": key, "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()

    results = []
    for item in data.get("results", []):
        properties = item.get("properties") or {}
        thumbnail = item.get("thumbnail") or {}
        image_url = properties.get("url") or thumbnail.get("src")
        if not image_url:
            continue
        results.append({
            "title": item.get("title") or "",
            "image_url": image_url,
            "thumbnail_url": thumbnail.get("src") or image_url,
            "page_url": item.get("url") or "",
            "source": item.get("source") or "",
            "width": properties.get("width"),
            "height": properties.get("height"),
        })
    return results


@router.post("/images")
async def search_images(
    body: ImageSearchRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    query = body.query.strip()
    if not query:
        return json_response(ResponseCode.BAD_REQUEST, "Query must not be empty")

    key = _resolve_search_key(workspace)
    if not key:
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Image search is not configured for this workspace",
            data={
                "error_code": "SEARCH_NOT_CONFIGURED",
                "hint": "Set a Brave Search API key in workspace settings (brave_search_api_key) "
                        "or the BRAVE_SEARCH_API_KEY env var on the backend.",
            },
        )

    count = max(1, min(body.count, MAX_RESULTS))
    try:
        results = await _brave_image_search(key, query, count, body.safesearch)
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status in (401, 403):
            return json_response(
                ResponseCode.BAD_REQUEST,
                "Image search API key was rejected",
                data={"error_code": "SEARCH_KEY_INVALID"},
            )
        if status == 429:
            return json_response(
                ResponseCode.BAD_REQUEST,
                "Image search rate limit exceeded — try again shortly",
                data={"error_code": "SEARCH_RATE_LIMITED"},
            )
        logger.error("Image search upstream error %s for query %r", status, query)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Image search failed (upstream {status})")
    except httpx.HTTPError as e:
        logger.error("Image search request failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Image search request failed")

    return success_response({"query": query, "results": results, "total": len(results)})

# -*- coding: utf-8 -*-
"""
Browser previews in Slack (roadmap v1.1 M6).

When an agent opens or navigates a shared cloud-browser tab *for* a workspace
thread that is bridged to Slack (an ``ext-slack-…`` channel), the Slack
conversation gets a visual preview of the page — a screenshot uploaded as a
file with a one-line comment — plus an entry point to the live browser view.
Humans following along in Slack see what the agent sees without opening the
workspace.

How a tab is tied to a thread
    The browser API is thread-agnostic, so the *caller* says which thread the
    tab is for: ``POST /v1/browser/tabs`` and ``…/navigate`` accept an optional
    ``channel`` (workspace channel name). The association is remembered per
    tab (Redis with an in-process fallback) so later navigations that omit
    ``channel`` still find it. A tab with no channel never produces a preview.

Audience
    Previews are posted only when the workspace channel is **not private**
    (``Channel.visibility != "private"``). A private thread's members chose a
    restricted audience; mirroring its browser content into a Slack channel
    would widen that audience, so private threads are skipped unconditionally
    — there is no override. (Bridged ``ext-…`` channels are created with the
    default ``workspace`` visibility, so the normal Slack case posts.)

Admin knob
    ``Workspace.settings["slack_browser_previews"]`` (JSONB, no schema change)
    — previews are on unless it is explicitly ``false``.

Throttle
    At most one preview per tab per :data:`PREVIEW_THROTTLE_SECONDS`, tracked
    in an in-process dict. Limitation: with several backend replicas each one
    keeps its own clock, so a burst of navigations spread across replicas can
    post up to one preview per replica per window. Good enough for a chat
    surface; move the stamp to Redis if it ever matters.

Failure policy
    Everything here is best-effort and runs after the browser response has
    been sent. Nothing raises: a Slack outage, a missing ``files:write`` scope
    or a broken screenshot only produces a log line (and ``last_error`` on the
    binding), never a failed browser operation.
"""

import asyncio
import logging
import time
from typing import Any, Optional

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app import cache
from app.browser import BrowserManager
from app.config import config
from app.database import SessionLocal
from app.models import Channel, Workspace
from app.services import integrations as bridge

logger = logging.getLogger(__name__)

PREVIEW_THROTTLE_SECONDS = 30.0
SCREENSHOT_TIMEOUT_SECONDS = 20.0
# How long a tab remembers the thread it was opened for. Temporary tabs idle
# out long before this; permanent tabs get re-associated on the next call
# that passes ``channel``.
TAB_CHANNEL_TTL_SECONDS = 24 * 3600.0
SETTING_KEY = "slack_browser_previews"

# tab_id -> monotonic time of the last preview attempt (see "Throttle" above).
_last_post: dict = {}
# tab_id -> channel name, fallback for when Redis is not configured.
_local_tab_channels: dict = {}


# ---------------------------------------------------------------------------
# Tab ↔ channel association
# ---------------------------------------------------------------------------

def remember_tab_channel(tab_id: str, channel_name: Optional[str]) -> None:
    """Record which workspace thread a tab is being driven for."""
    if not tab_id or not channel_name:
        return
    _local_tab_channels[tab_id] = channel_name
    try:
        cache.set_bytes(
            f"browser:channel:{tab_id}",
            channel_name.encode("utf-8"),
            ttl_seconds=TAB_CHANNEL_TTL_SECONDS,
        )
    except Exception:
        pass


def channel_for_tab(tab_id: str) -> Optional[str]:
    """The thread a tab was opened for, or None if the caller never said."""
    try:
        raw = cache.get_bytes(f"browser:channel:{tab_id}")
    except Exception:
        raw = None
    if raw:
        return raw.decode("utf-8", "replace")
    return _local_tab_channels.get(tab_id)


def forget_tab_channel(tab_id: str) -> None:
    _local_tab_channels.pop(tab_id, None)
    _last_post.pop(tab_id, None)
    try:
        cache.delete_key(f"browser:channel:{tab_id}")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Router hook
# ---------------------------------------------------------------------------

def is_agent_actor(actor: Optional[str]) -> bool:
    return bool(actor) and str(actor).startswith("openagents:")


def _snapshot_tab(tab: Any) -> dict:
    """Plain-dict copy of the fields the poster needs. Taken while the request's
    DB session is still open — the background task runs after it is closed,
    when touching an expired ORM attribute would raise."""
    if isinstance(tab, dict):
        return {
            "id": tab.get("id"),
            "url": tab.get("url"),
            "title": tab.get("title"),
            "live_url": tab.get("live_url"),
            "created_by": tab.get("created_by"),
            "screenshot_url": tab.get("screenshot_url"),
            "workspace_slug": tab.get("workspace_slug"),
        }
    return {
        "id": getattr(tab, "id", None),
        "url": getattr(tab, "url", None),
        "title": getattr(tab, "title", None),
        "live_url": getattr(tab, "live_url", None),
        "created_by": getattr(tab, "created_by", None),
        # Not a column today: the screenshot endpoint needs the workspace
        # token, so there is no public image URL to embed. Kept as a hook so
        # a future public snapshot URL lights up the image block below.
        "screenshot_url": getattr(tab, "screenshot_url", None),
    }


def schedule_browser_preview(background_tasks, workspace, channel_name: Optional[str],
                             tab: Any, actor: Optional[str], reason: str) -> None:
    """Called from the browser router right after a tab was opened/navigated.

    Records the tab ↔ channel association when the request named a channel,
    and queues :func:`maybe_post_browser_preview` as a FastAPI background task
    for agent actors. Never raises (the router additionally wraps the call).
    """
    try:
        tab_id = getattr(tab, "id", None) if not isinstance(tab, dict) else tab.get("id")
        if channel_name:
            remember_tab_channel(tab_id, channel_name)
        else:
            channel_name = channel_for_tab(tab_id)
        if not channel_name or not is_agent_actor(actor) or background_tasks is None:
            return
        snapshot = _snapshot_tab(tab)
        snapshot["workspace_slug"] = getattr(workspace, "slug", None)
        background_tasks.add_task(
            maybe_post_browser_preview,
            str(getattr(workspace, "id", "")), channel_name, snapshot, actor, reason,
        )
    except Exception:
        logger.debug("browser_preview: scheduling failed", exc_info=True)


# ---------------------------------------------------------------------------
# The poster
# ---------------------------------------------------------------------------

def _throttled(tab_id: str) -> bool:
    """True if a preview for this tab went out within the throttle window.
    Otherwise stamps now and returns False."""
    now = time.monotonic()
    last = _last_post.get(tab_id)
    if last is not None and now - last < PREVIEW_THROTTLE_SECONDS:
        return True
    _last_post[tab_id] = now
    return False


def _resolve_target(workspace_id: str, channel_name: str) -> Optional[dict]:
    """Where (and whether) to post. Sync — runs in the threadpool.

    Returns ``None`` when the workspace turned previews off, the channel is
    missing/private, or the channel is not bridged to an active Slack binding.
    """
    db = SessionLocal()
    try:
        workspace = db.get(Workspace, workspace_id)
        if workspace is None or workspace.status == "deleted":
            return None
        if (workspace.settings or {}).get(SETTING_KEY, True) is False:
            return None
        channel = db.execute(
            select(Channel).where(
                Channel.workspace_id == workspace_id,
                Channel.name == channel_name,
            )
        ).scalar_one_or_none()
        if channel is None or channel.status == "deleted":
            return None
        if channel.visibility == "private":
            return None  # never widen a private thread's audience
        slug = workspace.slug
    except Exception:
        logger.exception("browser_preview: target lookup failed")
        return None
    finally:
        db.close()

    resolved = bridge.resolve_binding_for_channel(workspace_id, channel_name)
    if resolved is None:
        return None
    binding, chat_id = resolved
    if binding.platform != "slack" or not binding.bot_token:
        return None
    return {
        "binding_id": str(binding.id),
        "bot_token": binding.bot_token,
        "chat_id": chat_id,
        # The bridge posts top-level messages today (no thread_ts anywhere in
        # relay_for_event). Plumbed through so a threaded bridge only has to
        # fill this in.
        "thread_ts": None,
        "workspace_slug": slug,
    }


async def take_screenshot(tab_id: str) -> bytes:
    """PNG bytes via the same BrowserManager path ``GET …/screenshot`` uses."""
    manager = BrowserManager.get()
    return await asyncio.wait_for(manager.screenshot(tab_id), timeout=SCREENSHOT_TIMEOUT_SECONDS)


def _escape(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _workspace_link(slug: Optional[str]) -> Optional[str]:
    if not slug:
        return None
    return f"{config.FRONTEND_BASE_URL.rstrip('/')}/{slug}"


def build_preview_text(actor: str, tab: dict, workspace_slug: Optional[str] = None) -> str:
    """``🌐 @scout is browsing: <title> — <url>`` + a link line."""
    agent = bridge._display_name(actor or "") or "agent"
    url = tab.get("url") or ""
    title = (tab.get("title") or "").strip()
    if title and title != url:
        what = f"{_escape(title[:200])} — <{url}>"
    else:
        what = f"<{url}>"
    lines = [f"🌐 *@{_escape(agent)}* is browsing: {what}"]
    links = []
    if tab.get("live_url"):
        links.append(f"<{tab['live_url']}|Open live browser view>")
    ws_link = _workspace_link(workspace_slug)
    if ws_link:
        links.append(f"<{ws_link}|Open in workspace>")
    if links:
        lines.append(" · ".join(links))
    return "\n".join(lines)


def build_preview_blocks(actor: str, tab: dict, workspace_slug: Optional[str] = None) -> list:
    """Block Kit fallback when the screenshot upload is unavailable."""
    blocks: list = [
        {"type": "section", "text": {"type": "mrkdwn", "text": build_preview_text(actor, tab, workspace_slug)}},
    ]
    if tab.get("screenshot_url"):
        blocks.append({
            "type": "image",
            "image_url": tab["screenshot_url"],
            "alt_text": (tab.get("title") or tab.get("url") or "Browser preview")[:200],
        })
    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": "Shared browser preview from OpenAgents Workspace"}],
    })
    return blocks


def _filename_for(tab: dict) -> str:
    return f"browser-preview-{str(tab.get('id') or 'tab')[:8]}.png"


def _post_preview(target: dict, tab: dict, actor: str, png: Optional[bytes]) -> None:
    """Upload the screenshot; fall back to a Block Kit message. Sync — runs in
    the threadpool. Raises only if *both* paths failed."""
    slug = tab.get("workspace_slug") or target.get("workspace_slug")
    text = build_preview_text(actor, tab, slug)
    title = (tab.get("title") or tab.get("url") or "Browser preview")[:200]
    upload_error: Optional[Exception] = None
    if png:
        try:
            bridge.slack_upload_file(
                target["bot_token"], target["chat_id"], png,
                filename=_filename_for(tab), title=title,
                initial_comment=text, thread_ts=target.get("thread_ts"),
            )
            return
        except Exception as exc:  # missing files:write, upload URL 4xx, network…
            upload_error = exc
            logger.info("browser_preview: upload failed, falling back to message: %s", exc)
    try:
        bridge.slack_post_blocks(
            target["bot_token"], target["chat_id"], text,
            build_preview_blocks(actor, tab, slug), thread_ts=target.get("thread_ts"),
        )
    except Exception as exc:
        if upload_error is not None:
            raise RuntimeError(f"{upload_error}; fallback: {exc}") from exc
        raise


async def maybe_post_browser_preview(workspace_id: str, channel_name: Optional[str],
                                     tab: Any, actor: Optional[str], reason: str) -> None:
    """Post a page preview to the Slack conversation bridged to ``channel_name``.

    ``reason`` is ``"opened"`` or ``"navigated"``. Skips silently when: the
    caller is not an agent, the tab has no channel or is on ``about:blank``,
    the workspace has ``settings.slack_browser_previews = false``, the thread
    is private, the channel is not bridged to an active Slack binding, or a
    preview for this tab went out in the last 30 s. Never raises.
    """
    try:
        if not is_agent_actor(actor) or not channel_name:
            return
        tab = _snapshot_tab(tab)
        tab_id = tab.get("id")
        url = tab.get("url") or ""
        if not tab_id or not url or url == "about:blank":
            return

        target = await run_in_threadpool(_resolve_target, workspace_id, channel_name)
        if target is None:
            return
        if _throttled(tab_id):
            logger.debug("browser_preview: throttled tab=%s", tab_id)
            return

        png: Optional[bytes] = None
        try:
            png = await take_screenshot(tab_id)
        except Exception as exc:
            logger.info("browser_preview: screenshot failed for tab %s (%s): %s", tab_id, reason, exc)

        error: Optional[str] = None
        try:
            await run_in_threadpool(_post_preview, target, tab, actor, png)
        except Exception as exc:
            logger.warning("browser_preview: slack post failed for tab %s: %s", tab_id, exc)
            error = str(exc)
        bridge._record_binding_result(target["binding_id"], error)
    except Exception:
        logger.exception("browser_preview: unexpected failure (reason=%s)", reason)

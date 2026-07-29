# -*- coding: utf-8 -*-
"""
Cloud agent invocation — background task that calls third-party APIs
when a message is routed to a cloud agent.

Wired into routers/events.py via FastAPI BackgroundTasks, same pattern
as push.py.
"""

import asyncio
import json as _json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from app.config import config
from app.database import SessionLocal
from app.models import CloudAgentConfig, EventRecord, FileRecord, Workspace
from app.services.cloud_providers import audio_generation, chat_completion, image_generation

logger = logging.getLogger(__name__)


def _mask_key(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return key[:4] + "..." + key[-4:]


async def invoke_cloud_agents(workspace_id: str, event_data: dict) -> None:
    """Background task: invoke any cloud agents targeted by a message event."""
    metadata = event_data.get("metadata") or {}
    target_agents = metadata.get("target_agents") or []

    if not target_agents or target_agents == ["__no_response__"]:
        return

    depth = metadata.get("cloud_agent_depth", 0)
    if depth >= config.CLOUD_AGENT_MAX_DEPTH:
        logger.warning("cloud_agent: max depth %d reached, skipping", depth)
        return

    names = [n for n in target_agents if n != "__no_response__"]
    if not names:
        return

    # Invoke all targeted cloud agents concurrently — a message like
    # "@a task1 @b task2" must not make b wait for a's API round-trip.
    # Each invocation gets its own DB session because SQLAlchemy sessions
    # are not safe to share across concurrently running tasks.
    await asyncio.gather(
        *(_invoke_guarded(workspace_id, event_data, name, depth) for name in names)
    )


async def _invoke_guarded(
    workspace_id: str, event_data: dict, agent_name: str, depth: int,
) -> None:
    """Look up one cloud agent's config and invoke it, posting an error
    message to the channel on failure. Owns its DB session so concurrent
    invocations don't share one."""
    db = SessionLocal()
    try:
        cloud_config = db.execute(
            select(CloudAgentConfig).where(
                CloudAgentConfig.workspace_id == workspace_id,
                CloudAgentConfig.agent_name == agent_name,
                CloudAgentConfig.status == "active",
            )
        ).scalar_one_or_none()

        if not cloud_config:
            return

        try:
            await _invoke_single(db, workspace_id, event_data, cloud_config, depth)
        except Exception as exc:
            logger.exception(
                "cloud_agent: failed to invoke %s (%s/%s)",
                agent_name, cloud_config.provider, cloud_config.model,
            )
            error_detail = str(exc)[:200] if str(exc) else "Unknown error"
            # Use a fresh DB session for error posting — the original
            # session may be stale after a long async API call.
            await _post_error_message(
                workspace_id, event_data, agent_name,
                f"Failed to get a response from {cloud_config.provider}/{cloud_config.model}: "
                f"{error_detail}",
            )
    finally:
        db.close()


async def _invoke_single(
    db, workspace_id: str, event_data: dict,
    cloud_config: CloudAgentConfig, depth: int,
) -> None:
    """Invoke a single cloud agent and post the response."""
    channel_target = event_data.get("target", "")
    agent_name = cloud_config.agent_name

    if cloud_config.category == "image":
        await _invoke_image_agent(db, workspace_id, event_data, cloud_config)
    elif cloud_config.category == "audio":
        await _invoke_audio_agent(db, workspace_id, event_data, cloud_config)
    else:
        await _invoke_chat_agent(db, workspace_id, event_data, cloud_config, depth)


async def _invoke_chat_agent(
    db, workspace_id: str, event_data: dict,
    cloud_config: CloudAgentConfig, depth: int,
) -> None:
    """Invoke a chat cloud agent."""
    channel_target = event_data.get("target", "")
    agent_name = cloud_config.agent_name

    messages = _build_conversation_context(db, workspace_id, channel_target, agent_name)

    content = event_data.get("payload", {}).get("content", "")
    if content:
        messages.append({"role": "user", "content": content})

    if not messages:
        return

    logger.info(
        "cloud_agent: invoking %s (%s/%s) with %d messages",
        agent_name, cloud_config.provider, cloud_config.model, len(messages),
    )

    response_text = await chat_completion(
        api_key=cloud_config.api_key,
        provider=cloud_config.provider,
        model=cloud_config.model,
        messages=messages,
        system_prompt=cloud_config.system_prompt,
        max_tokens=cloud_config.max_tokens,
        base_url=cloud_config.base_url,
    )

    await _post_response(
        db, workspace_id, channel_target, agent_name,
        response_text, depth,
    )


async def _invoke_image_agent(
    db, workspace_id: str, event_data: dict,
    cloud_config: CloudAgentConfig,
) -> None:
    """Invoke an image generation cloud agent."""
    import re
    channel_target = event_data.get("target", "")
    agent_name = cloud_config.agent_name
    instruction = event_data.get("payload", {}).get("content", "")
    instruction = re.sub(r"@\S+\s*", "", instruction).strip()

    if not instruction:
        return

    # Resolve referential instructions ("based on the content above") into a
    # concrete prompt using recent channel history. Falls back to the raw
    # instruction when no router LLM / no context is available.
    prompt = await _compose_image_prompt(
        db, workspace_id, channel_target, agent_name, instruction,
    )
    if not prompt:
        return

    logger.info(
        "cloud_agent: generating image with %s (%s/%s)",
        agent_name, cloud_config.provider, cloud_config.model,
    )

    image_bytes, image_format = await image_generation(
        api_key=cloud_config.api_key,
        provider=cloud_config.provider,
        model=cloud_config.model,
        prompt=prompt,
        base_url=cloud_config.base_url,
    )

    file_id = await _upload_image(
        db, workspace_id, channel_target, agent_name,
        image_bytes, image_format, prompt,
    )

    channel_name = channel_target.replace("channel/", "") if channel_target.startswith("channel/") else None
    content_type = f"image/{image_format}"
    filename = f"generated_{file_id[:8]}.{image_format}"

    await _post_response(
        db, workspace_id, channel_target, agent_name,
        f"Here's the generated image for: *{instruction[:100]}*",
        depth=0,
        attachments=[{
            "file_id": file_id,
            "filename": filename,
            "content_type": content_type,
            "size": len(image_bytes),
        }],
    )


async def _invoke_audio_agent(
    db, workspace_id: str, event_data: dict,
    cloud_config: CloudAgentConfig,
) -> None:
    """Invoke a text-to-speech cloud agent."""
    channel_target = event_data.get("target", "")
    agent_name = cloud_config.agent_name
    text = event_data.get("payload", {}).get("content", "")

    if not text:
        return

    logger.info(
        "cloud_agent: generating audio with %s (%s/%s)",
        agent_name, cloud_config.provider, cloud_config.model,
    )

    audio_bytes, audio_format = await audio_generation(
        api_key=cloud_config.api_key,
        provider=cloud_config.provider,
        model=cloud_config.model,
        text=text,
    )

    file_id = await _upload_image(
        db, workspace_id, channel_target, agent_name,
        audio_bytes, audio_format, text,
    )

    filename = f"speech_{file_id[:8]}.{audio_format}"

    await _post_response(
        db, workspace_id, channel_target, agent_name,
        f"Generated speech for: *{text[:100]}*",
        depth=0,
        attachments=[{
            "file_id": file_id,
            "filename": filename,
            "content_type": f"audio/{audio_format}",
            "size": len(audio_bytes),
        }],
    )


def _build_conversation_context(
    db, workspace_id: str, channel_target: str, agent_name: str,
) -> list[dict]:
    """Fetch recent messages from the channel as conversation context."""
    max_messages = config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES

    rows = db.execute(
        select(EventRecord)
        .where(
            EventRecord.network_id == workspace_id,
            EventRecord.target == channel_target,
            EventRecord.type == "workspace.message.posted",
        )
        .order_by(EventRecord.timestamp.desc())
        .limit(max_messages + 1)
    ).scalars().all()

    rows = list(reversed(rows))
    if rows:
        rows = rows[:-1]

    messages = []
    for row in rows:
        payload = row.payload or {}
        msg_type = payload.get("message_type", "chat")
        if msg_type in ("thinking", "status", "todos"):
            continue

        content = payload.get("content", "")
        if not content:
            continue

        source = row.source or ""
        if source.startswith("human:") or (source.startswith("openagents:") and source != f"openagents:{agent_name}"):
            messages.append({"role": "user", "content": content})
        elif source == f"openagents:{agent_name}":
            messages.append({"role": "assistant", "content": content})

    return messages


async def _compose_image_prompt(
    db, workspace_id: str, channel_target: str, agent_name: str, instruction: str,
) -> str:
    """Turn a (possibly referential) instruction like "make an image of
    cherie's brief above" into a concrete, self-contained image prompt by
    reading recent channel history.

    Image agents used to render the literal instruction text — so a request
    like "generate an image based on the content above" produced a picture
    of that sentence, because the image path never read context (unlike the
    chat path). Here we feed recent messages + the instruction to a small
    LLM and ask for the final image prompt, mirroring _invoke_chat_agent.

    Falls back to the raw instruction when no router LLM is configured, when
    there is no prior context to resolve against, or on any error — prompt
    composition must never block image generation.
    """
    api_key = config.ROUTER_LLM_API_KEY or config.ANTHROPIC_API_KEY
    if not (config.ROUTER_LLM_ENABLED and api_key):
        return instruction

    context = _build_conversation_context(db, workspace_id, channel_target, agent_name)
    if not context:
        return instruction

    provider = config.ROUTER_LLM_PROVIDER
    model = config.ROUTER_LLM_MODEL or (
        "gpt-4o-mini" if provider == "openai" else "claude-haiku-4-5-20251001"
    )

    system_prompt = (
        "You write prompts for an image-generation model. Read the recent "
        "conversation, then turn the user's latest image request into ONE "
        "concrete, self-contained image prompt.\n"
        "- Resolve references such as 'the content above', \"cherie's brief\", "
        "or 'mkt-bot's summary' to the ACTUAL text from the conversation.\n"
        "- Include the real content/text that should appear in the image.\n"
        "- Preserve any explicit layout, style, format, or aspect-ratio "
        "instructions from the request.\n"
        "- Output ONLY the final image prompt — no preamble, no explanation, "
        "no surrounding quotes."
    )
    messages = list(context)
    messages.append({
        "role": "user",
        "content": f"Image request: {instruction}\n\nWrite the final image prompt.",
    })

    try:
        composed = await chat_completion(
            api_key=api_key,
            provider=provider,
            model=model,
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=1200,
            base_url=config.ROUTER_LLM_BASE_URL or None,
        )
        composed = (composed or "").strip()
        if composed:
            logger.info(
                "cloud_agent: composed image prompt from %d context msg(s) "
                "(%d -> %d chars)",
                len(context), len(instruction), len(composed),
            )
            return composed
        return instruction
    except Exception as exc:
        logger.warning(
            "cloud_agent: image prompt composition failed, using raw instruction: %s",
            exc,
        )
        return instruction


async def _upload_image(
    db, workspace_id: str, channel_target: str, agent_name: str,
    image_bytes: bytes, image_format: str, prompt: str,
) -> str:
    """Upload generated image to file storage."""
    from app.storage import get_file_store

    file_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"uploaded_files/{timestamp}_generated.{image_format}"
    storage_name = f"{timestamp}_generated.{image_format}"

    store = get_file_store()
    loop = asyncio.get_event_loop()
    storage_key = await loop.run_in_executor(
        None, store.save, workspace_id, file_id, storage_name, image_bytes,
    )

    channel_name = channel_target.replace("channel/", "") if channel_target.startswith("channel/") else None

    record = FileRecord(
        id=file_id,
        workspace_id=workspace_id,
        filename=filename,
        content_type=f"image/{image_format}",
        size=len(image_bytes),
        storage_key=storage_key,
        uploaded_by=f"openagents:{agent_name}",
        channel_name=channel_name,
    )
    db.add(record)
    db.flush()

    return file_id


async def _post_response(
    db, workspace_id: str, channel_target: str, agent_name: str,
    content: str, depth: int,
    attachments: Optional[list] = None,
) -> None:
    """Post the cloud agent's response back through the event pipeline."""
    from app.models import Workspace
    from app.pipeline_factory import pipeline
    from openagents.core.onm_events import Event
    from openagents.core.onm_mods import EventRejected, PipelineContext

    workspace = db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    ).scalar_one_or_none()

    if not workspace:
        logger.error("cloud_agent: workspace %s not found", workspace_id)
        return

    payload: dict = {
        "content": content,
        "message_type": "chat",
    }
    if attachments:
        payload["attachments"] = attachments

    event = Event(
        type="workspace.message.posted",
        source=f"openagents:{agent_name}",
        target=channel_target,
        payload=payload,
        metadata={"cloud_agent_depth": depth + 1},
        visibility="channel",
        network=workspace_id,
    )

    context = PipelineContext(
        network_id=workspace_id,
        agent_address=event.source,
        db=db,
        workspace=workspace,
        token=workspace.password_hash,
    )

    try:
        await pipeline.process(event, context)
    except EventRejected as exc:
        logger.warning("cloud_agent: response event rejected: %s", exc.reason)
        return

    db.commit()

    # Publish to Redis so SSE clients receive the event in real-time
    try:
        from app import cache
        snapshot = {
            "id": event.id,
            "type": event.type,
            "source": event.source,
            "target": event.target,
            "payload": event.payload,
            "metadata": event.metadata,
            "timestamp": event.timestamp,
        }
        cache.publish_event(
            f"ws:{workspace_id}:events",
            _json.dumps(snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        pass


async def _post_error_message(
    workspace_id: str, event_data: dict, agent_name: str, error_text: str,
) -> None:
    """Post an error message to the channel on behalf of the cloud agent.

    Opens its own short-lived DB session so a stale connection from a
    long-running API call cannot prevent the error from reaching the user.
    """
    err_db = SessionLocal()
    try:
        await _post_response(
            err_db, workspace_id,
            event_data.get("target", ""),
            agent_name,
            f"[Error] {error_text}",
            depth=0,
        )
    except Exception:
        logger.exception("cloud_agent: failed to post error message for %s", agent_name)
    finally:
        err_db.close()

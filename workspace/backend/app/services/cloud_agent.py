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
from app.services.cloud_providers import (
    audio_generation,
    chat_completion,
    chat_completion_tools,
    image_generation,
)

logger = logging.getLogger(__name__)

# The image prompt composer only needs enough history to resolve references
# like "the brief above" and runs on a small router model, so it gets a much
# tighter context budget than the chat path.
_IMAGE_CONTEXT_MAX_CHARS = 8000


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

    db = SessionLocal()
    try:
        for agent_name in target_agents:
            if agent_name == "__no_response__":
                continue

            cloud_config = db.execute(
                select(CloudAgentConfig).where(
                    CloudAgentConfig.workspace_id == workspace_id,
                    CloudAgentConfig.agent_name == agent_name,
                    CloudAgentConfig.status == "active",
                )
            ).scalar_one_or_none()

            if not cloud_config:
                continue

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

    if cloud_config.category == "assistant":
        await _invoke_assistant_agent(db, workspace_id, event_data, cloud_config, depth)
    elif cloud_config.category == "image":
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

    # Capture config into locals up front so we don't touch the (soon-expired)
    # ORM object after releasing the DB connection below (see db.rollback()
    # before the LLM call).
    provider = cloud_config.provider
    model = cloud_config.model
    api_key = cloud_config.api_key
    base_url = cloud_config.base_url
    system_prompt = cloud_config.system_prompt
    max_tokens = cloud_config.max_tokens

    # The char budget covers the whole request, not just history — system
    # prompt and the trigger message spend from it first, history gets the
    # remainder. An absurdly long trigger is truncated so the assembled
    # payload always stays within CLOUD_AGENT_MAX_CONTEXT_CHARS.
    content = event_data.get("payload", {}).get("content", "")
    total_budget = config.CLOUD_AGENT_MAX_CONTEXT_CHARS
    system_len = len(system_prompt or "")
    if system_len >= total_budget:
        # Without this the trigger would be truncated to an empty string and
        # the invocation silently dropped. Raising surfaces the problem to
        # the user via the caller's error handler instead.
        raise ValueError(
            f"system prompt ({system_len} chars) leaves no room in the "
            f"context budget ({total_budget} chars) — shorten the prompt or "
            f"raise CLOUD_AGENT_MAX_CONTEXT_CHARS"
        )
    if content and system_len + len(content) > total_budget:
        logger.warning(
            "cloud_agent: trigger message for %s exceeds the context budget "
            "(%d + %d > %d chars), truncating",
            agent_name, system_len, len(content), total_budget,
        )
        content = content[: max(0, total_budget - system_len)]

    messages = _build_conversation_context(
        db, workspace_id, channel_target, agent_name,
        exclude_event_id=event_data.get("id"),
        before_timestamp=_event_order_boundary(event_data),
        max_chars=max(0, total_budget - system_len - len(content)),
    )

    if content:
        messages.append({"role": "user", "content": content})

    if not messages:
        return

    logger.info(
        "cloud_agent: invoking %s (%s/%s) with %d messages",
        agent_name, provider, model, len(messages),
    )

    # Release the DB connection while we wait on the (multi-second) LLM call.
    # Holding it idle-in-transaction across the wait gets it dropped by
    # Postgres/pgbouncer -> "SSL connection has been closed unexpectedly" on
    # the next query. pool_pre_ping re-validates on the next checkout.
    db.rollback()

    response_text = await chat_completion(
        api_key=api_key,
        provider=provider,
        model=model,
        messages=messages,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        base_url=base_url,
    )

    await _post_response(
        db, workspace_id, channel_target, agent_name,
        response_text, depth,
    )


async def _invoke_assistant_agent(
    db, workspace_id: str, event_data: dict,
    cloud_config: CloudAgentConfig, depth: int,
) -> None:
    """Invoke a tool-using assistant agent (Yumi) with a hand-rolled
    function-calling loop.

    Unlike the single-shot chat path, this lets the agent call server-side
    tools (list/create threads, etc.) across several turns before producing a
    final answer, which is posted as a normal chat message.
    """
    from app.services import yumi

    channel_target = event_data.get("target", "")
    agent_name = cloud_config.agent_name

    # Capture config into locals: we release the DB connection between LLM
    # calls (below), which expires ORM objects, so we must not read from
    # cloud_config inside the loop.
    provider = cloud_config.provider
    model = cloud_config.model
    max_tokens = cloud_config.max_tokens
    api_key, base_url = yumi.resolve_credentials(cloud_config)
    if not api_key:
        logger.error("assistant %s: no API key configured", agent_name)
        await _post_error_message(
            workspace_id, event_data, agent_name,
            "This assistant isn't configured on the server yet (missing key).",
        )
        return

    messages = _build_conversation_context(db, workspace_id, channel_target, agent_name)
    content = event_data.get("payload", {}).get("content", "")
    if content:
        messages.append({"role": "user", "content": content})
    if not messages:
        return

    system_prompt = cloud_config.system_prompt or yumi.YUMI_SYSTEM_PROMPT
    system_prompt = system_prompt + "\n\n" + yumi.workspace_state_summary(db, workspace_id)
    tools = yumi.build_tools()
    max_iters = max(1, config.YUMI_MAX_TOOL_ITERATIONS)

    logger.info(
        "assistant: invoking %s (%s/%s), %d ctx msgs, max %d tool iters",
        agent_name, provider, model, len(messages), max_iters,
    )

    final_text = ""
    for i in range(max_iters):
        # On the last allowed iteration, drop tools so the model must answer.
        use_tools = tools if i < max_iters - 1 else None
        # Release the DB connection while we wait on the (multi-second) LLM
        # call. Holding it idle-in-transaction across the wait — especially
        # across several tool-loop iterations — gets it dropped by
        # Postgres/pgbouncer, surfacing as "SSL connection has been closed
        # unexpectedly" on the next query (e.g. in _post_response). The next
        # DB op re-checks-out a validated connection (pool_pre_ping).
        db.rollback()
        msg = await chat_completion_tools(
            api_key=api_key,
            provider=provider,
            model=model,
            messages=messages,
            tools=use_tools,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            base_url=base_url,
        )

        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            final_text = msg.get("content", "") or ""
            break

        # Record the assistant's tool-call turn, then execute each call and
        # feed results back as `tool` messages.
        messages.append(msg)
        for tc in tool_calls:
            fn = tc.get("function", {})
            try:
                args = _json.loads(fn.get("arguments") or "{}")
            except Exception:
                args = {}
            result = await yumi.execute_tool(
                db, workspace_id, channel_target, agent_name, fn.get("name", ""), args,
            )
            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id"),
                "content": _json.dumps(result, default=str),
            })

    if not final_text:
        final_text = (
            "I've done what I can for now — let me know if you'd like anything else!"
        )

    await _post_response(
        db, workspace_id, channel_target, agent_name, final_text, depth,
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
        exclude_event_id=event_data.get("id"),
        before_timestamp=_event_order_boundary(event_data),
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


def _event_order_boundary(event_data: dict) -> Optional[int]:
    """Best-effort extraction of the triggering event's timestamp (unix ms)."""
    try:
        return int(event_data.get("timestamp"))
    except (TypeError, ValueError):
        return None


def _build_conversation_context(
    db, workspace_id: str, channel_target: str, agent_name: str,
    exclude_event_id: Optional[str] = None,
    before_timestamp: Optional[int] = None,
    max_chars: Optional[int] = None,
) -> list[dict]:
    """Fetch recent messages from the channel as conversation context.

    Only events causally prior to the trigger are eligible. When
    before_timestamp is given, rows at or after it are excluded in SQL, so
    a message committed after the trigger can never leak into this request
    and get answered early. Events carry no ordering finer than the unix-ms
    timestamp, so rows sharing the trigger's millisecond are conservatively
    dropped too. Without a boundary, the newest row is assumed to be the
    trigger and skipped (legacy behavior); exclude_event_id is a further
    guard for the id-only case.

    Chat messages are collected newest-first in pages until the window
    holds max_messages of them, the character budget is spent, or the scan
    cap is reached — non-chat rows (status/thinking/todos/anything else)
    never consume window slots. The character budget bounds prompt size for
    models with small context windows, which a message count alone does not.

    The scan cap makes this best-effort, deliberately: without it a busy
    channel would degrade into an unbounded table scan. If the most recent
    max_scanned rows are all noise, older chat history is invisible for
    this turn — a warning is logged when that happens.
    """
    max_messages = config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES
    if max_chars is None:
        max_chars = config.CLOUD_AGENT_MAX_CONTEXT_CHARS

    batch_size = max(max_messages * 3, 100)
    max_scanned = batch_size * 10

    collected: list[dict] = []  # newest -> oldest
    used_chars = 0
    offset = 0
    drop_newest = exclude_event_id is None and before_timestamp is None

    while len(collected) < max_messages and offset < max_scanned:
        query = select(EventRecord).where(
            EventRecord.network_id == workspace_id,
            EventRecord.target == channel_target,
            EventRecord.type == "workspace.message.posted",
        )
        if before_timestamp is not None:
            query = query.where(EventRecord.timestamp < before_timestamp)

        rows = db.execute(
            query.order_by(EventRecord.timestamp.desc(), EventRecord.id.desc())
            .offset(offset)
            .limit(batch_size)
        ).scalars().all()
        if not rows:
            break

        done = False
        for row in rows:
            if drop_newest:
                drop_newest = False
                continue
            if exclude_event_id is not None and row.id == exclude_event_id:
                continue

            payload = row.payload or {}
            if payload.get("message_type", "chat") != "chat":
                continue
            content = payload.get("content", "")
            if not content:
                continue

            source = row.source or ""
            if source == f"openagents:{agent_name}":
                role = "assistant"
            elif source.startswith("human:") or source.startswith("openagents:"):
                role = "user"
            else:
                continue

            if used_chars + len(content) > max_chars:
                # Keep at least a truncated newest message so the model
                # is never invoked with the trigger's context fully empty.
                if not collected and max_chars > 0:
                    collected.append({"role": role, "content": content[:max_chars]})
                done = True
                break

            collected.append({"role": role, "content": content})
            used_chars += len(content)
            if len(collected) >= max_messages:
                done = True
                break

        if done or len(rows) < batch_size:
            break
        offset += batch_size

    if len(collected) < max_messages and offset >= max_scanned:
        logger.warning(
            "cloud_agent: context scan cap (%d rows) reached for %s in %s "
            "with only %d chat message(s) collected — older history, if any, "
            "is invisible this turn",
            max_scanned, agent_name, channel_target, len(collected),
        )

    collected.reverse()
    return collected


async def _compose_image_prompt(
    db, workspace_id: str, channel_target: str, agent_name: str, instruction: str,
    exclude_event_id: Optional[str] = None,
    before_timestamp: Optional[int] = None,
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

    user_prompt = f"Image request: {instruction}\n\nWrite the final image prompt."

    # As in the chat path, the budget covers the whole composer request —
    # the system prompt and the full user message (wrapper text included)
    # spend from it first and history gets what remains.
    context = _build_conversation_context(
        db, workspace_id, channel_target, agent_name,
        exclude_event_id=exclude_event_id,
        before_timestamp=before_timestamp,
        max_chars=max(
            0, _IMAGE_CONTEXT_MAX_CHARS - len(system_prompt) - len(user_prompt)
        ),
    )
    if not context:
        return instruction

    provider = config.ROUTER_LLM_PROVIDER
    model = config.ROUTER_LLM_MODEL or (
        "gpt-4o-mini" if provider == "openai" else "claude-haiku-4-5-20251001"
    )
    messages = list(context)
    messages.append({"role": "user", "content": user_prompt})

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

    # If this reply lands in a workflow thread, advance the run. Cloud replies
    # go through the pipeline directly (not the POST /v1/events route), so the
    # route's advance hook never sees them. advance_workflow is a no-op when the
    # channel has no active run; run it off the event loop so we don't block.
    try:
        import asyncio
        from app.services.workflow import advance_workflow
        wf_event = {
            "target": event.target,
            "source": event.source,
            "payload": event.payload,
            "metadata": event.metadata,
        }
        asyncio.get_running_loop().run_in_executor(
            None, advance_workflow, workspace_id, wf_event,
        )
    except Exception:
        logger.warning("cloud_agent: failed to schedule workflow advance", exc_info=True)


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

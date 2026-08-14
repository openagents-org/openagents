# -*- coding: utf-8 -*-
"""External thread ↔ OA channel mapping.

Two hazards shape this module.

**Concurrent webhooks.** Slack can deliver the first two messages of a new
thread close enough together that both ingests find no mapping and both try to
create the channel. `channels` has a unique index on (workspace, name), so the
loser would simply crash. The fix is to make the name a pure function of the
binding and the conversation: both racers compute the same name, both attempt
an insert, one wins, and the loser reads the winner's row.

**Rebinding.** If the name were derived from the external key alone, then
disconnecting a Slack workspace and reconnecting it would land on the channel
the *previous* binding used — quietly handing the new agent the old
conversation's history. Including the binding id makes a rebind start clean,
and the unique constraint on `channel_id` enforces that an OA channel belongs
to exactly one binding, permanently.

The external key is composed here, never accepted from the caller. A gateway
that could hand us an arbitrary key string could aim two different Slack
conversations at one channel, or collide with another binding's namespace.
"""

import hashlib
import logging
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.integrations.principal import IntegrationPrincipal
from app.models import Channel, ChannelMember, IntegrationConversation

logger = logging.getLogger(__name__)

# Kinds a conversation can take. `dm` is a single rolling conversation with one
# platform user; `thread` is one reply thread inside a group channel; `channel`
# is a group conversation with no thread (Telegram plain groups, mostly).
CONVERSATION_KINDS = ("dm", "channel", "thread")


class ScopeError(ValueError):
    """The conversation lies outside what this binding was granted."""


def build_external_key(
    platform: str,
    *,
    kind: str,
    tenant_id: str,
    conversation_id: str,
    thread_id: Optional[str] = None,
) -> str:
    """Compose the canonical identifier for one external conversation.

    Deliberately structured rather than free-form: the caller supplies the
    platform's own ids and we assemble them, so the key space stays ours.
    """
    if kind not in CONVERSATION_KINDS:
        raise ValueError(f"unknown conversation kind: {kind}")
    parts = [platform, kind, tenant_id or "-", conversation_id or "-"]
    if kind == "thread":
        parts.append(thread_id or "-")
    return "/".join(parts)


def channel_name_for(binding_id: str, external_key: str) -> str:
    """Derive the OA channel name. Same inputs, same name, on every replica.

    32 hex characters of SHA-256 — 128 bits. There is no reason to shave the
    name shorter and reintroduce a collision question nobody wants to reason
    about later.
    """
    digest = hashlib.sha256(external_key.encode("utf-8")).hexdigest()[:32]
    return f"integration:{binding_id}:{digest}"


def check_scope(principal: IntegrationPrincipal, kind: str, conversation_id: str) -> None:
    """Enforce the binding's declared reach. Raises ScopeError when exceeded.

    This is the server-side half of "user picks DM only, or these channels".
    The gateway also filters, but its filter is a convenience — this one is the
    guarantee.
    """
    if kind == "dm":
        if not principal.allows_dm():
            raise ScopeError("this binding does not cover direct messages")
        return
    if not principal.allows_channel(conversation_id):
        raise ScopeError(f"channel {conversation_id} is not in this binding's scope")


def resolve_conversation(
    db: Session,
    principal: IntegrationPrincipal,
    *,
    kind: str,
    tenant_id: str,
    conversation_id: str,
    thread_id: Optional[str] = None,
    title: Optional[str] = None,
) -> Tuple[IntegrationConversation, bool]:
    """Find or create the channel backing one external conversation.

    Returns ``(mapping, created)``. Flushes but does not commit — the caller
    owns the transaction, because for an ingest the mapping, the channel and
    the message all have to land together or not at all.
    """
    check_scope(principal, kind, conversation_id)

    external_key = build_external_key(
        principal.platform,
        kind=kind,
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        thread_id=thread_id,
    )

    existing = db.execute(
        select(IntegrationConversation).where(
            IntegrationConversation.binding_id == principal.binding_id,
            IntegrationConversation.external_key == external_key,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    channel_name = channel_name_for(principal.binding_id, external_key)

    # A savepoint, so losing the race costs us this insert and not the caller's
    # whole transaction. Both racers computed the same name, so whoever loses
    # can simply read what the winner wrote.
    try:
        with db.begin_nested():
            channel = Channel(
                workspace_id=principal.workspace_id,
                name=channel_name,
                title=title or _default_title(kind, conversation_id),
                created_by=f"integration:{principal.platform}",
                # One agent owns the thread, so routing is a fixed answer rather
                # than something the LLM router has to decide per message.
                master_agent=principal.agent_name,
                status="active",
            )
            db.add(channel)
            db.flush()

            db.add(ChannelMember(channel_id=channel.id, agent_name=principal.agent_name))
            mapping = IntegrationConversation(
                binding_id=principal.binding_id,
                external_key=external_key,
                conversation_kind=kind,
                channel_id=channel.id,
                channel_name=channel_name,
            )
            db.add(mapping)
            db.flush()
        return mapping, True
    except IntegrityError:
        # Someone else got there first. Their row is authoritative.
        mapping = db.execute(
            select(IntegrationConversation).where(
                IntegrationConversation.binding_id == principal.binding_id,
                IntegrationConversation.external_key == external_key,
            )
        ).scalar_one_or_none()
        if mapping is None:
            # The unique violation came from somewhere other than this race —
            # most plausibly a channel of that name owned by a different
            # binding, which the channel_id constraint exists to prevent. Not
            # recoverable here; let it surface rather than guessing.
            logger.error(
                "integration: could not resolve conversation after conflict "
                "(binding=%s key=%s)", principal.binding_id, external_key,
            )
            raise
        return mapping, False


def _default_title(kind: str, conversation_id: str) -> str:
    """A readable placeholder until the first message auto-titles the thread."""
    if kind == "dm":
        return "Direct message"
    if kind == "thread":
        return "Thread"
    return f"Channel {conversation_id}"


def channel_names_for_binding(db: Session, binding_id: str) -> list:
    """Every OA channel this binding owns. Used by the outbound query."""
    return list(db.execute(
        select(IntegrationConversation.channel_name).where(
            IntegrationConversation.binding_id == binding_id,
        )
    ).scalars().all())

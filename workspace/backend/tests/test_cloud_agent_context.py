# -*- coding: utf-8 -*-
"""
Tests for the cloud-agent conversation context builder.

Covers the fixes for constraint loss in long conversations: the window holds
real chat messages (noise never consumes slots, up to a best-effort scan cap
that is logged when hit), context stops at the trigger's causal boundary so
later messages can't leak in, a character budget bounds the whole request
independently of message count, and the window size follows
CLOUD_AGENT_MAX_CONTEXT_MESSAGES.
"""

import asyncio
import logging
import types
import uuid

import pytest

from app.config import config
from app.models import EventRecord
from app.services import cloud_agent
from app.services.cloud_agent import _build_conversation_context

WORKSPACE_ID = str(uuid.uuid4())
CHANNEL = "channel/general"
AGENT = "opus-bot"


def _add_message(db, ts, content, source="human:user1", message_type="chat",
                 event_id=None):
    event_id = event_id or f"ev-{ts}"
    db.add(EventRecord(
        id=event_id,
        network_id=WORKSPACE_ID,
        type="workspace.message.posted",
        source=source,
        target=CHANNEL,
        payload={"content": content, "message_type": message_type},
        metadata_={},
        timestamp=ts,
    ))
    return event_id


def _build(db, exclude_event_id=None, before_timestamp=None, max_chars=None):
    return _build_conversation_context(
        db, WORKSPACE_ID, CHANNEL, AGENT,
        exclude_event_id=exclude_event_id,
        before_timestamp=before_timestamp,
        max_chars=max_chars,
    )


class TestTriggerBoundary:
    def test_messages_after_trigger_are_excluded(self, db):
        """A message committed after the trigger must not leak into this
        request — it will trigger its own invocation."""
        _add_message(db, 1, "history message")
        trigger_id = _add_message(db, 2, "trigger @opus-bot do the thing")
        _add_message(db, 3, "late concurrent message")
        db.commit()

        messages = _build(db, exclude_event_id=trigger_id, before_timestamp=2)

        contents = [m["content"] for m in messages]
        assert contents == ["history message"]

    def test_same_millisecond_rows_are_conservatively_dropped(self, db):
        """Events carry no sub-millisecond ordering, so rows sharing the
        trigger's timestamp are excluded rather than risking a leak."""
        _add_message(db, 1, "clearly before")
        _add_message(db, 2, "same millisecond", event_id="ev-tie")
        trigger_id = _add_message(db, 2, "trigger", event_id="ev-trigger")
        db.commit()

        messages = _build(db, exclude_event_id=trigger_id, before_timestamp=2)

        assert [m["content"] for m in messages] == ["clearly before"]

    def test_id_only_fallback_still_excludes_trigger(self, db):
        _add_message(db, 1, "history message")
        trigger_id = _add_message(db, 2, "trigger")
        db.commit()

        messages = _build(db, exclude_event_id=trigger_id)

        assert "trigger" not in [m["content"] for m in messages]
        assert "history message" in [m["content"] for m in messages]

    def test_without_any_boundary_drops_newest_row(self, db):
        """Legacy behavior is preserved when no boundary info is supplied."""
        _add_message(db, 1, "history message")
        _add_message(db, 2, "current message")
        db.commit()

        messages = _build(db)

        assert [m["content"] for m in messages] == ["history message"]


class TestConversationWindow:
    def test_early_constraint_survives_long_conversation(self, db):
        """A constraint from turn 1 must still reach the model at turn 30."""
        _add_message(db, 1, "CONSTRAINT the user_id field is confirmed as uuid")
        for i in range(2, 60):
            role = "human:user1" if i % 2 == 0 else f"openagents:{AGENT}"
            _add_message(db, i, f"turn {i}", source=role)
        db.commit()

        messages = _build(db, before_timestamp=60)

        assert any("CONSTRAINT" in m["content"] for m in messages)

    def test_noise_rows_do_not_consume_window_slots(self, db):
        _add_message(db, 1, "real early message")
        for i in range(2, 2 + config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES):
            _add_message(db, i, f"status {i}", source=f"openagents:{AGENT}",
                         message_type="status")
        db.commit()

        messages = _build(db, before_timestamp=10_000)

        assert messages == [{"role": "user", "content": "real early message"}]

    def test_noise_beyond_overfetch_batch_does_not_evict_real_messages(self, db):
        """More noise rows than a single over-fetch batch (3x window) must
        not push real conversation out — pagination keeps scanning."""
        batch_size = max(config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES * 3, 100)
        _add_message(db, 1, "real early message")
        for i in range(2, 2 + batch_size + 50):
            _add_message(db, i, f"thinking {i}", source=f"openagents:{AGENT}",
                         message_type="thinking")
        db.commit()

        messages = _build(db, before_timestamp=1_000_000)

        assert messages == [{"role": "user", "content": "real early message"}]

    def test_non_chat_types_are_excluded_by_allowlist(self, db):
        """Only message_type == "chat" (or absent) belongs in context —
        error/queue_cancel/etc. must be excluded, not just known noise."""
        _add_message(db, 1, "kept chat")
        _add_message(db, 2, "an error", message_type="error")
        _add_message(db, 3, "cancelled", message_type="queue_cancel")
        _add_message(db, 4, "status", message_type="status")
        db.commit()

        messages = _build(db, before_timestamp=100)

        assert [m["content"] for m in messages] == ["kept chat"]

    def test_window_caps_at_max_messages(self, db):
        limit = config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES
        for i in range(limit + 20):
            _add_message(db, i, f"msg {i}")
        db.commit()

        messages = _build(db, before_timestamp=limit + 20)

        assert len(messages) == limit
        # The window keeps the most recent messages, dropping the oldest.
        assert messages[-1]["content"] == f"msg {limit + 19}"
        assert messages[0]["content"] == f"msg {20}"

    def test_role_mapping(self, db):
        _add_message(db, 1, "from human", source="human:user1")
        _add_message(db, 2, "from own agent", source=f"openagents:{AGENT}")
        _add_message(db, 3, "from other agent", source="openagents:other-bot")
        db.commit()

        messages = _build(db, before_timestamp=100)

        assert messages == [
            {"role": "user", "content": "from human"},
            {"role": "assistant", "content": "from own agent"},
            {"role": "user", "content": "from other agent"},
        ]

    def test_empty_content_skipped(self, db):
        _add_message(db, 1, "kept")
        _add_message(db, 2, "")
        db.commit()

        messages = _build(db, before_timestamp=100)

        assert [m["content"] for m in messages] == ["kept"]


class TestCharBudget:
    def test_budget_loads_newest_messages_first(self, db):
        """Message count alone is not a safe context bound — the char budget
        keeps the newest messages and drops older ones once spent."""
        _add_message(db, 1, "a" * 10)
        _add_message(db, 2, "b" * 10)
        _add_message(db, 3, "c" * 10)
        db.commit()

        messages = _build(db, before_timestamp=100, max_chars=25)

        assert [m["content"] for m in messages] == ["b" * 10, "c" * 10]

    def test_single_overlong_message_is_truncated_not_dropped(self, db):
        _add_message(db, 1, "abcdefghij")
        db.commit()

        messages = _build(db, before_timestamp=100, max_chars=5)

        assert [m["content"] for m in messages] == ["abcde"]

    def test_default_budget_is_configured(self):
        assert config.CLOUD_AGENT_MAX_CONTEXT_CHARS > 0

    def test_final_provider_payload_stays_within_total_budget(self, db, monkeypatch):
        """The budget covers the assembled request — system prompt, history
        and the trigger message together, not history alone."""
        for i in range(10):
            _add_message(db, i, "x" * 20_000)
        db.commit()

        captured = {}

        async def fake_chat_completion(**kwargs):
            captured.update(kwargs)
            return "ok"

        async def fake_post_response(*args, **kwargs):
            return None

        monkeypatch.setattr(cloud_agent, "chat_completion", fake_chat_completion)
        monkeypatch.setattr(cloud_agent, "_post_response", fake_post_response)
        monkeypatch.setattr(config, "CLOUD_AGENT_MAX_CONTEXT_CHARS", 50_000)

        cloud_config = types.SimpleNamespace(
            agent_name=AGENT, provider="openai", model="test-model",
            api_key="key", system_prompt="s" * 1_000, max_tokens=100,
            base_url=None, category="chat",
        )
        event_data = {
            "id": "ev-trigger", "target": CHANNEL,
            "payload": {"content": "c" * 5_000}, "timestamp": 100,
        }

        asyncio.run(cloud_agent._invoke_chat_agent(
            db, WORKSPACE_ID, event_data, cloud_config, depth=0,
        ))

        total = len(cloud_config.system_prompt) + sum(
            len(m["content"]) for m in captured["messages"]
        )
        assert total <= 50_000
        # The trigger message itself is the final user message, intact.
        assert captured["messages"][-1] == {"role": "user", "content": "c" * 5_000}

    def test_overlong_trigger_is_truncated_to_budget(self, db, monkeypatch):
        captured = {}

        async def fake_chat_completion(**kwargs):
            captured.update(kwargs)
            return "ok"

        async def fake_post_response(*args, **kwargs):
            return None

        monkeypatch.setattr(cloud_agent, "chat_completion", fake_chat_completion)
        monkeypatch.setattr(cloud_agent, "_post_response", fake_post_response)
        monkeypatch.setattr(config, "CLOUD_AGENT_MAX_CONTEXT_CHARS", 1_000)

        cloud_config = types.SimpleNamespace(
            agent_name=AGENT, provider="openai", model="test-model",
            api_key="key", system_prompt="", max_tokens=100,
            base_url=None, category="chat",
        )
        event_data = {
            "id": "ev-trigger", "target": CHANNEL,
            "payload": {"content": "c" * 5_000}, "timestamp": 100,
        }

        asyncio.run(cloud_agent._invoke_chat_agent(
            db, WORKSPACE_ID, event_data, cloud_config, depth=0,
        ))

        assert captured["messages"] == [{"role": "user", "content": "c" * 1_000}]

    def test_system_prompt_consuming_whole_budget_raises(self, db, monkeypatch):
        """A system prompt at or over the budget must fail loudly — the
        caller's error handler posts the failure to the user — instead of
        truncating the trigger to nothing and silently dropping the turn."""
        called = {"chat": False}

        async def fake_chat_completion(**kwargs):
            called["chat"] = True
            return "ok"

        monkeypatch.setattr(cloud_agent, "chat_completion", fake_chat_completion)
        monkeypatch.setattr(config, "CLOUD_AGENT_MAX_CONTEXT_CHARS", 1_000)

        cloud_config = types.SimpleNamespace(
            agent_name=AGENT, provider="openai", model="test-model",
            api_key="key", system_prompt="s" * 1_000, max_tokens=100,
            base_url=None, category="chat",
        )
        event_data = {
            "id": "ev-trigger", "target": CHANNEL,
            "payload": {"content": "hello"}, "timestamp": 100,
        }

        with pytest.raises(ValueError, match="context budget"):
            asyncio.run(cloud_agent._invoke_chat_agent(
                db, WORKSPACE_ID, event_data, cloud_config, depth=0,
            ))
        assert not called["chat"]

    def test_image_composer_payload_stays_within_its_budget(self, db, monkeypatch):
        """The composer budget covers the whole request including the
        user-message wrapper text, not just the raw instruction."""
        for i in range(10):
            _add_message(db, i, "x" * 3_000)
        db.commit()

        captured = {}

        async def fake_chat_completion(**kwargs):
            captured.update(kwargs)
            return "a composed prompt"

        monkeypatch.setattr(cloud_agent, "chat_completion", fake_chat_completion)
        monkeypatch.setattr(config, "ROUTER_LLM_ENABLED", True)
        monkeypatch.setattr(config, "ROUTER_LLM_API_KEY", "key")

        instruction = "draw the brief above"
        result = asyncio.run(cloud_agent._compose_image_prompt(
            db, WORKSPACE_ID, CHANNEL, AGENT, instruction,
            before_timestamp=100,
        ))

        assert result == "a composed prompt"
        total = len(captured["system_prompt"]) + sum(
            len(m["content"]) for m in captured["messages"]
        )
        assert total <= cloud_agent._IMAGE_CONTEXT_MAX_CHARS
        # The final user message carries the wrapper text around the
        # instruction, and it is what the budget accounted for.
        assert captured["messages"][-1]["content"] == (
            f"Image request: {instruction}\n\nWrite the final image prompt."
        )


class TestScanCap:
    def test_scan_cap_is_best_effort_and_logged(self, db, caplog):
        """When the newest max_scanned rows are all noise, older chat
        history is invisible for the turn — documented best-effort behavior
        that must surface as a warning, never silently."""
        batch_size = max(config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES * 3, 100)
        max_scanned = batch_size * 10

        _add_message(db, 1, "buried real message")
        db.bulk_save_objects([
            EventRecord(
                id=f"noise-{i}",
                network_id=WORKSPACE_ID,
                type="workspace.message.posted",
                source=f"openagents:{AGENT}",
                target=CHANNEL,
                payload={"content": f"status {i}", "message_type": "status"},
                metadata_={},
                timestamp=10 + i,
            )
            for i in range(max_scanned + 1)
        ])
        db.commit()

        with caplog.at_level(logging.WARNING):
            messages = _build(db, before_timestamp=10_000_000)

        assert messages == []
        assert any("scan cap" in r.message for r in caplog.records)


class TestDefaultWindowSize:
    def test_default_covers_long_conversations(self):
        """The old default of 10 (5 turns) caused early-constraint loss by
        turn 6; the raised default must cover far longer conversations."""
        assert config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES >= 100
